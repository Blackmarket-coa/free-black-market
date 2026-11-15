import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * SD-74: the vendor sales report and both analytics dashboards on a real
 * database, through a real vendor login.
 *
 * All three ran raw SQL with Postgres `$n` placeholders, which knex's `raw`
 * does not bind ("Expected N bindings, saw 0"), and two read
 * `order_line_item.order_id`, `.quantity` and `.total`, which Medusa 2 does not
 * have (a line's quantity is on `order_item`). And the two dashboards scoped
 * by `_seller_id || actor_id`, where a vendor login's actor is a member id, so
 * they answered zeros. Their unit specs checked SQL strings; nothing ran one.
 *
 * The token here is the real login's, a member (mem_*) id, which is what the
 * vendor panel sends.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

    async function productFor(sellerId: string, title: string) {
      const id = uid()
      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([{ title, handle: `p-${id}`, status: "published" }])
      await container()
        .resolve(ContainerRegistrationKeys.LINK)
        .create({ [SELLER_MODULE]: { seller_id: sellerId }, [Modules.PRODUCT]: { product_id: product.id } })
      return product
    }

    async function order(
      lines: Array<{ product: { id: string; title: string }; quantity: number; unit_price: number }>,
      extra: Record<string, unknown> = {}
    ) {
      const [created] = await container()
        .resolve(Modules.ORDER)
        .createOrders([
          {
            currency_code: "usd",
            email: "buyer@example.com",
            items: lines.map((l) => ({
              title: l.product.title,
              product_title: l.product.title,
              product_id: l.product.id,
              variant_title: "Default",
              variant_sku: `SKU-${l.product.title}`,
              quantity: l.quantity,
              unit_price: l.unit_price,
            })),
            ...extra,
          },
        ])
      return created
    }

    async function event(row: Record<string, unknown>) {
      const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      await pg.raw(
        `INSERT INTO analytics_event (id, event_name, product_id, creator_seller_id, utm_campaign, occurred_at)
         VALUES (?, ?, ?, ?, ?, now() - interval '1 day')`,
        [`ae_${uid()}`, row.event_name, row.product_id ?? null, row.creator_seller_id ?? null, row.utm_campaign ?? null]
      )
    }

    async function world() {
      const vendor = await createAuthenticatedSeller({ api, getContainer })
      const rival = await createAuthenticatedSeller({ api, getContainer })
      const apron = await productFor(vendor.seller.id, "Linen Apron")
      const mug = await productFor(rival.seller.id, "Clay Mug")

      // A placed order with one of the vendor's lines and one of the rival's.
      const placed = await order([
        { product: apron, quantity: 2, unit_price: 12.5 },
        { product: mug, quantity: 1, unit_price: 7 },
      ])
      // Not sales: a canceled order and a draft order for the same product.
      const canceled = await order([{ product: apron, quantity: 5, unit_price: 12.5 }])
      await container().resolve(Modules.ORDER).cancel(canceled.id)
      await order([{ product: apron, quantity: 3, unit_price: 12.5 }], { is_draft_order: true, status: "draft" })

      return { vendor, rival, apron, mug, placed }
    }

    describe("GET /vendor/sales-report", () => {
      it("reports the vendor's own lines on placed orders, with quantities and money as the order module stores them", async () => {
        const { vendor, apron, placed } = await world()
        expect(vendor.actorId.startsWith("mem_")).toBe(true)

        const res = await safe(api.get("/vendor/sales-report", authHeader(vendor.token)))
        expect(res.status).toBe(200)
        expect(res.data.summary).toEqual({
          total_revenue: 25,
          total_orders: 1,
          total_units_sold: 2,
          avg_order_value: 25,
        })
        expect(res.data.line_items).toHaveLength(1)
        expect(res.data.line_items[0]).toMatchObject({
          order_id: placed.id,
          product_id: apron.id,
          product_title: "Linen Apron",
          quantity: 2,
          unit_price: 12.5,
          line_total: 25,
          currency_code: "usd",
        })
      })

      it("exports the same rows as CSV in major units", async () => {
        const { vendor } = await world()
        const res = await safe(api.get("/vendor/sales-report?format=csv", authHeader(vendor.token)))
        expect(res.status).toBe(200)
        expect(String(res.headers["content-type"])).toContain("text/csv")
        const rows = String(res.data).trim().split("\n")
        expect(rows).toHaveLength(2)
        expect(rows[1]).toMatch(/,"Linen Apron","Default","SKU-Linen Apron",2,12\.50,25\.00,"usd"$/)
      })
    })

    describe("GET /vendor/analytics/products", () => {
      it("counts the vendor's views, adds to cart and placed-order units, for the vendor's products only", async () => {
        const { vendor, apron, mug } = await world()
        for (let i = 0; i < 3; i++) await event({ event_name: "product_view", product_id: apron.id })
        await event({ event_name: "add_to_cart", product_id: apron.id })
        await event({ event_name: "product_view", product_id: mug.id })

        const res = await safe(api.get("/vendor/analytics/products?range=30", authHeader(vendor.token)))
        expect(res.status).toBe(200)
        expect(res.data.funnel).toMatchObject({ views: 3, add_to_carts: 1, orders: 1, units: 2 })
        expect(res.data.by_product).toEqual([
          expect.objectContaining({ product_id: apron.id, views: 3, add_to_carts: 1, orders: 1, units: 2 }),
        ])
        expect(res.data.by_day.reduce((sum: number, d: { views: number }) => sum + d.views, 0)).toBe(3)
      })
    })

    describe("GET /vendor/analytics/creator", () => {
      it("counts the creator events recorded against the vendor's seller id", async () => {
        const { vendor, rival } = await world()
        await event({ event_name: "creator_profile_view", creator_seller_id: vendor.seller.id, utm_campaign: "spring" })
        await event({ event_name: "creator_profile_view", creator_seller_id: vendor.seller.id })
        await event({ event_name: "creator_link_clicked", creator_seller_id: vendor.seller.id, utm_campaign: "spring" })
        await event({ event_name: "creator_profile_view", creator_seller_id: rival.seller.id })

        const res = await safe(api.get("/vendor/analytics/creator?range=30", authHeader(vendor.token)))
        expect(res.status).toBe(200)
        expect(res.data.totals).toMatchObject({ profile_views: 2, link_clicks: 1, attributed_orders: 0 })
        expect(res.data.by_campaign).toEqual(
          expect.arrayContaining([expect.objectContaining({ campaign: "spring", events: 2, link_clicks: 1 })])
        )
      })
    })
  },
})
