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
 *
 * SD-74 follow-up: the first version of this spec never sent dates, so it
 * missed that the panel's date-only end_date (default: today) was read as the
 * first instant of that day and dropped that day's orders; and it gave the
 * vendor one product, so it missed the funnel counting an order once per
 * product in it. The cases below send the panel's exact query shape and put
 * two of the vendor's products in one order.
 *
 * Every createAuthenticatedSeller spends two POSTs of the /auth limiter's 20
 * per minute (register, then login), and the whole file runs inside one
 * window: new checks extend the existing cases where they can rather than
 * each building a fresh vendor and rival.
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

    /** Move an order's placement time, as if it had been placed then. */
    async function placedAt(orderId: string, at: Date) {
      const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      await pg.raw(`UPDATE "order" SET created_at = ? WHERE id = ?`, [at.toISOString(), orderId])
    }

    /**
     * The query the panel sends by default, built as
     * vendor-panel/src/routes/sales-report/sales-report.tsx getDefaultDateRange()
     * and vendor-panel/src/hooks/api/sales-report.ts salesReportQuery() build
     * it: the last 30 calendar days ending today in the browser's zone (here,
     * this process's), each sent as the instant that bounds that local day,
     * with that zone's name as time_zone.
     * Until SD-89 (a) it sent the UTC calendar dates themselves.
     */
    function panelDefaultQuery() {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - 30)
      const localMidnight = (d: Date, addDays = 0) =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays)
      return new URLSearchParams({
        start_date: localMidnight(start).toISOString(),
        end_date: new Date(localMidnight(end, 1).getTime() - 1).toISOString(),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }).toString()
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
          by_currency: [{ currency_code: "usd", total_revenue: 25, total_orders: 1, avg_order_value: 25 }],
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

        // A second currency in the window: money stays per currency, and there
        // is no cross-currency total ($25 plus EUR 10 is not 35 of anything).
        await order([{ product: apron, quantity: 1, unit_price: 10 }], { currency_code: "eur" })
        const mixed = await safe(api.get("/vendor/sales-report", authHeader(vendor.token)))
        expect(mixed.status).toBe(200)
        expect(mixed.data.summary).toEqual({
          total_revenue: null,
          total_orders: 2,
          total_units_sold: 3,
          avg_order_value: null,
          by_currency: [
            { currency_code: "eur", total_revenue: 10, total_orders: 1, avg_order_value: 10 },
            { currency_code: "usd", total_revenue: 25, total_orders: 1, avg_order_value: 25 },
          ],
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

      it("with the dates the panel sends: today's order is in the default range, a vendor's local evening is in their day and, with time_zone, dated that day in the export, a date-only end date is that whole UTC day, and a bad date or zone is a 400", async () => {
        const vendor = await createAuthenticatedSeller({ api, getContainer })
        const get = (query: string) => safe(api.get(`/vendor/sales-report?${query}`, authHeader(vendor.token)))
        /** The file name the backend gives an export, from Content-Disposition. */
        const fileName = (r: { headers: Record<string, unknown> }) =>
          /^attachment; filename="([^"]+)"$/.exec(String(r.headers["content-disposition"]))?.[1]
        const LA = new URLSearchParams({ time_zone: "America/Los_Angeles" }).toString()

        // SD-89: before the vendor has a product the export is its header row
        // alone, from a separate branch of the route that names the file too.
        // Los Angeles' 13 November 2025 is 08:00Z on the 13th to 07:59:59.999Z
        // on the 14th: named by UTC dates without a zone, by the vendor's with.
        const laNov13 = new URLSearchParams({
          start_date: "2025-11-13T08:00:00.000Z",
          end_date: "2025-11-14T07:59:59.999Z",
          format: "csv",
        }).toString()
        for (const [query, name] of [
          [laNov13, "sales-report-2025-11-13-to-2025-11-14.csv"],
          [`${laNov13}&${LA}`, "sales-report-2025-11-13-to-2025-11-13.csv"],
        ]) {
          const empty = await get(query)
          expect(empty.status).toBe(200)
          expect(String(empty.data).trim().split("\n")).toHaveLength(1)
          expect(fileName(empty)).toBe(name)
        }

        const apron = await productFor(vendor.seller.id, "Linen Apron")
        const placed = await order([{ product: apron, quantity: 2, unit_price: 12.5 }])

        // The panel's default request (end_date = today) with an order placed
        // just now. This read zero orders: the end date meant its midnight.
        const query = panelDefaultQuery()
        const res = await get(query)
        expect(res.status).toBe(200)
        expect(res.data.summary).toMatchObject({ total_orders: 1, total_units_sold: 2, total_revenue: 25 })
        expect(res.data.line_items.map((l: { order_id: string }) => l.order_id)).toEqual([placed.id])
        // The window ends at the instant the panel sent: the last millisecond
        // of the end date, not its first.
        expect(res.data.date_range.end).toBe(new URLSearchParams(query).get("end_date"))
        const csv = await get(`${query}&format=csv`)
        expect(csv.status).toBe(200)
        expect(String(csv.data).trim().split("\n")).toHaveLength(2)
        // The export is named by the calendar dates the panel's vendor picked:
        // the local dates of the window's two ends, in the zone it sent.
        const localDate = (iso: string | null) => {
          const d = new Date(String(iso))
          return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-")
        }
        const sentRange = new URLSearchParams(query)
        expect(fileName(csv)).toBe(
          `sales-report-${localDate(sentRange.get("start_date"))}-to-${localDate(sentRange.get("end_date"))}.csv`
        )

        // Placed yesterday at 15:00 UTC, after the end date's first instant:
        // counted with end_date = yesterday, and a one-day range is that day.
        const now = new Date()
        const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
        const day = yesterday.toISOString().split("T")[0]
        await placedAt(placed.id, new Date(yesterday.getTime() + 15 * 60 * 60 * 1000))
        for (const q of [`end_date=${day}`, `start_date=${day}&end_date=${day}`]) {
          const r = await get(q)
          expect(r.status).toBe(200)
          expect(r.data.summary).toMatchObject({ total_orders: 1, total_units_sold: 2, total_revenue: 25 })
        }
        const dayBefore = new Date(yesterday.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]
        const before = await get(`start_date=${dayBefore}&end_date=${dayBefore}`)
        expect(before.status).toBe(200)
        expect(before.data.summary.total_orders).toBe(0)

        // SD-89 (a): a vendor in Los Angeles (UTC-8 in November) asks for
        // 13 November. The panel sends the instants that bound that local day,
        // as salesReportQuery builds them in their browser. One order was
        // placed at 19:30 that evening, which is 03:30 UTC on the 14th; another
        // at the next local midnight exactly. Dates in 2025, far from "now", so
        // the orders above cannot fall in these windows.
        const evening = await order([{ product: apron, quantity: 1, unit_price: 9 }])
        await placedAt(evening.id, new Date("2025-11-13T19:30:00-08:00"))
        const nextMidnight = await order([{ product: apron, quantity: 3, unit_price: 1 }])
        await placedAt(nextMidnight.id, new Date("2025-11-14T00:00:00-08:00"))
        const range = (start_date: string, end_date: string) =>
          new URLSearchParams({ start_date, end_date }).toString()
        const orderIds = (r: { data: { line_items: Array<{ order_id: string }> } }) =>
          r.data.line_items.map((l) => l.order_id)

        const nov13 = range("2025-11-13T08:00:00.000Z", "2025-11-14T07:59:59.999Z")
        const local13 = await get(nov13)
        expect(local13.status).toBe(200)
        expect(orderIds(local13)).toEqual([evening.id])
        expect(local13.data.summary).toMatchObject({ total_orders: 1, total_units_sold: 1, total_revenue: 9 })
        expect(local13.data.date_range).toEqual({
          start: "2025-11-13T08:00:00.000Z",
          end: "2025-11-14T07:59:59.999Z",
        })
        // The same day written with its offset reads the same.
        const withOffset = await get(range("2025-11-13T00:00:00-08:00", "2025-11-13T23:59:59.999-08:00"))
        expect(withOffset.status).toBe(200)
        expect(orderIds(withOffset)).toEqual([evening.id])
        // The CSV export is sent the same instants and has the same row.
        const local13Csv = await get(`${nov13}&format=csv`)
        expect(local13Csv.status).toBe(200)
        const csvRows = String(local13Csv.data).trim().split("\n")
        expect(csvRows).toHaveLength(2)
        expect(csvRows[1]).toMatch(/,1,9\.00,9\.00,"usd"$/)

        // SD-89: the dates the export writes. The evening order was placed at
        // 2025-11-14T03:30Z, the 13th for the vendor. Without time_zone the
        // Date cell and the file name are UTC dates, as they always were (the
        // 14th, a date outside the day the vendor asked for). With the panel's
        // time_zone both are the vendor's 13th, and nothing else in the row
        // changes.
        const dateCell = (row: string) => row.split(",")[1]
        expect(new Date("2025-11-13T19:30:00-08:00").toISOString()).toBe("2025-11-14T03:30:00.000Z")
        expect(dateCell(csvRows[1])).toBe('"2025-11-14"')
        expect(fileName(local13Csv)).toBe("sales-report-2025-11-13-to-2025-11-14.csv")
        const zonedCsv = await get(`${nov13}&format=csv&${LA}`)
        expect(zonedCsv.status).toBe(200)
        expect(String(zonedCsv.headers["content-type"])).toContain("text/csv")
        const zonedRows = String(zonedCsv.data).trim().split("\n")
        expect(zonedRows).toHaveLength(2)
        expect(dateCell(zonedRows[1])).toBe('"2025-11-13"')
        expect(zonedRows[1]).toBe(csvRows[1].replace('"2025-11-14"', '"2025-11-13"'))
        expect(zonedRows[0]).toBe(csvRows[0])
        expect(fileName(zonedCsv)).toBe("sales-report-2025-11-13-to-2025-11-13.csv")
        // Two local days, newest first: the order at the 14th's local midnight
        // is the 14th either way; the evening order is the 13th only in the
        // vendor's zone. The window ends at 07:59:59.999Z on the 15th, which is
        // the 14th there.
        const twoDays = range("2025-11-13T08:00:00.000Z", "2025-11-15T07:59:59.999Z")
        const twoDaysUtc = await get(`${twoDays}&format=csv`)
        expect(String(twoDaysUtc.data).trim().split("\n").slice(1).map(dateCell)).toEqual([
          '"2025-11-14"',
          '"2025-11-14"',
        ])
        expect(fileName(twoDaysUtc)).toBe("sales-report-2025-11-13-to-2025-11-15.csv")
        const twoDaysZoned = await get(`${twoDays}&format=csv&${LA}`)
        expect(String(twoDaysZoned.data).trim().split("\n").slice(1).map(dateCell)).toEqual([
          '"2025-11-14"',
          '"2025-11-13"',
        ])
        expect(fileName(twoDaysZoned)).toBe("sales-report-2025-11-13-to-2025-11-14.csv")
        // East of UTC the same instant is the 14th, and the window's ends are
        // the 14th and the 15th.
        const tokyo = await get(`${nov13}&format=csv&time_zone=Asia%2FTokyo`)
        expect(String(tokyo.data).trim().split("\n").slice(1).map(dateCell)).toEqual(['"2025-11-14"'])
        expect(fileName(tokyo)).toBe("sales-report-2025-11-13-to-2025-11-14.csv")
        // The JSON report is the same with and without the zone: its
        // order_date is the instant, which the panel renders in the browser's
        // own zone, so it needs no server-side date.
        const zonedJson = await get(`${nov13}&${LA}`)
        expect(zonedJson.status).toBe(200)
        expect(zonedJson.data).toEqual(local13.data)
        expect(zonedJson.data.line_items[0].order_date).toBe("2025-11-14T03:30:00.000Z")
        // The next local day has the midnight order and not the evening one.
        const local14 = await get(range("2025-11-14T08:00:00.000Z", "2025-11-15T07:59:59.999Z"))
        expect(local14.status).toBe(200)
        expect(orderIds(local14)).toEqual([nextMidnight.id])
        // What the panel used to send for that day, the date-only 2025-11-13,
        // is the UTC day, and the vendor's evening order is not in it.
        const utc13 = await get("start_date=2025-11-13&end_date=2025-11-13")
        expect(utc13.status).toBe(200)
        expect(orderIds(utc13)).toEqual([])

        // A date it cannot read is the caller's error, not a 500.
        for (const q of ["end_date=garbage", "start_date=2026-02-31", "end_date=2026-13-01&format=csv"]) {
          const bad = await get(q)
          expect(bad.status).toBe(400)
          expect(bad.data).toMatchObject({ type: "invalid_data" })
        }

        // So is a time_zone that is not an IANA zone name, for the JSON report
        // and the export alike: an unknown zone, a UTC offset (which Intl
        // would take), SQL- and header-shaped text, and a repeated parameter.
        // The refusal does not repeat what was sent.
        const zoneQuery = (time_zone: string) => new URLSearchParams({ time_zone }).toString()
        for (const q of [
          zoneQuery("Mars/Phobos"),
          zoneQuery("-08:00"),
          zoneQuery(`America/Los_Angeles'; DROP TABLE "order"; --`),
          zoneQuery('UTC".csv"\r\nX-Injected: 1'),
          `${LA}&${LA}`,
        ]) {
          for (const format of ["", "&format=csv"]) {
            const bad = await get(`${nov13}&${q}${format}`)
            expect(bad.status).toBe(400)
            expect(bad.data).toEqual({
              type: "invalid_data",
              message: "time_zone must be an IANA time zone name, for example America/Los_Angeles",
            })
            expect(bad.headers["content-disposition"]).toBeUndefined()
          }
        }
        // And the orders are still there to report.
        const after = await get(`${nov13}&format=csv&${LA}`)
        expect(after.status).toBe(200)
        expect(String(after.data).trim().split("\n")).toEqual(zonedRows)
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

        // A second order holding two of the vendor's products is ONE order.
        // Adding up the per-product counts gave apron 2 + towel 1 = 3 orders,
        // and a conversion of 3/4 for two orders over four views.
        const towel = await productFor(vendor.seller.id, "Tea Towel")
        await order([
          { product: apron, quantity: 1, unit_price: 12.5 },
          { product: towel, quantity: 1, unit_price: 9 },
        ])
        await event({ event_name: "product_view", product_id: towel.id })

        const after = await safe(api.get("/vendor/analytics/products?range=30", authHeader(vendor.token)))
        expect(after.status).toBe(200)
        expect(after.data.funnel).toEqual({ views: 4, add_to_carts: 1, orders: 2, units: 4, conversion: 0.5 })
        expect(after.data.by_product).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ product_id: apron.id, orders: 2, units: 3 }),
            expect.objectContaining({ product_id: towel.id, orders: 1, units: 1 }),
          ])
        )
        // And it agrees with the sales report's order count.
        const report = await safe(api.get("/vendor/sales-report", authHeader(vendor.token)))
        expect(report.data.summary.total_orders).toBe(2)
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
