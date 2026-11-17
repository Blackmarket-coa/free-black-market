import fs from "fs"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DEMAND_POOL_MODULE } from "../../src/modules/demand-pool"
import type DemandPoolModuleService from "../../src/modules/demand-pool/service"
import { authHeader, createAuthenticatedSeller, ensureStoreInfra, safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * The vendor panel's "Launch a Business", on a database built from the
 * migrations, priced in what a buyer is charged.
 *
 * `POST /v1/seller/launches` documents `price` as minor units, and the panel
 * sends 1200 for "12.00" (`vendor-panel/src/routes/launch-business/
 * launch-business.tsx`; `find-creators.tsx` sends a PRODUCT launch the same
 * way). Medusa prices are major units, and the route handed the 1200 over
 * as-is: a launch typed at $12.00 published a variant priced 1200, which the
 * storefront showed as $1,200.00. It now converts at the route.
 *
 * Read back two ways: the stored variant price, and what the storefront's own
 * product-page query (`storefront/src/lib/data/product-query.ts`, sent as the
 * js-sdk sends it) returns as the price a buyer sees. A launch also writes a
 * demand post and a bounty with no milestones, which on this database needs
 * SD-63's migrations.
 */

const STOREFRONT_QUERY = path.resolve(__dirname, "../../../storefront/src/lib/data/product-query.ts")

type Query = Record<string, string | number | string[] | undefined>
type StorefrontProductQuery = {
  productPageQuery: (input: { handle: string; regionId: string; countryCode?: string; stock?: boolean }) => Query
}

function loadStorefront(): StorefrontProductQuery | null {
  if (!fs.existsSync(STOREFRONT_QUERY)) {
    // As in store-product-page-query.spec.ts: in CI the whole repo is there,
    // and a missing file must fail, never pass by skipping.
    if (process.env.CI) throw new Error(`storefront product queries not found at ${STOREFRONT_QUERY}`)
    return null
  }
  return jest.requireActual(STOREFRONT_QUERY) as StorefrontProductQuery
}

/** `qs.stringify(query, { skipNulls: true })`, as `@medusajs/js-sdk` sends it. */
function toQueryString(query: Query): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      value.forEach((item, i) => parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`))
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts.join("&")
}

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const storefront = loadStorefront()
    const run = storefront ? it : it.skip

    run("a business launched at $12.00 publishes a $12.00 product: stored as 12, and 12 on the storefront's product page", async () => {
      const container = getContainer()
      const uid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

      // A storefront: the one sales channel the launch publishes into, behind
      // a publishable key, and a US region in dollars.
      const { salesChannelId } = await ensureStoreInfra(container)
      const [key] = await container
        .resolve(Modules.API_KEY)
        .createApiKeys([{ title: "storefront", type: "publishable", created_by: "test" }])
      await container.resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.API_KEY]: { publishable_key_id: key.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
      })
      const [region] = await container
        .resolve(Modules.REGION)
        .createRegions([{ name: "United States", currency_code: "usd", countries: ["us"] }])

      const seller = await createAuthenticatedSeller({ api, getContainer })

      // The panel's request for a product typed at "12.00", built as
      // launch-business.tsx builds it.
      const typed = "12.00"
      const launched = await safe(
        api.post(
          "/v1/seller/launches",
          {
            launch_type: "BUSINESS",
            title: `Compost ${uid}`,
            slug: `compost-${uid}`,
            price: Math.round(parseFloat(typed) * 100),
            business: { producer_name: `Sunrise Farm ${uid}`, producer_handle: `sunrise-${uid}` },
          },
          authHeader(seller.token)
        )
      )
      expect({ status: launched.status, body: launched.status === 201 ? null : launched.data }).toEqual({ status: 201, body: null })
      const productId: string = launched.data.launch.product_id

      // Stored: Medusa's price is 12, in major units.
      const {
        data: [product],
      } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
        entity: "product",
        fields: ["id", "handle", "status", "variants.prices.amount", "variants.prices.currency_code", "sales_channels.id"],
        filters: { id: productId },
      })
      expect(product.status).toBe("published")
      expect(product.sales_channels.map((c: { id: string }) => c.id)).toEqual([salesChannelId])
      expect(product.variants).toHaveLength(1)
      expect(product.variants[0].prices.map((p: { amount: unknown; currency_code: string }) => [Number(p.amount), p.currency_code])).toEqual([
        [12, "usd"],
      ])

      // The storefront: its product page asks for the price in the region.
      const page = await safe(
        api.get(
          `/store/products?${toQueryString(storefront!.productPageQuery({ handle: product.handle, regionId: region.id, countryCode: "us" }))}`,
          { headers: { "x-publishable-api-key": key.token } }
        )
      )
      expect(page.status).toBe(200)
      expect(page.data.products.map((p: { id: string }) => p.id)).toEqual([productId])
      expect(page.data.products[0].variants[0].calculated_price).toMatchObject({
        calculated_amount: 12,
        original_amount: 12,
        currency_code: "usd",
      })

      // The rest of the launch landed: its demand post, and its bounty with no
      // milestones (the panel sends none).
      const pools = container.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
      const posts = await pools.listDemandPosts({ launch_id: launched.data.launch.launch_id })
      expect(posts.map((p) => p.id)).toEqual([launched.data.launch.demand_post_id])
      const bounties = await pools.listDemandBounties({ demand_post_id: posts[0].id })
      expect(bounties.map((b) => [b.id, b.milestones])).toEqual([[launched.data.launch.bounty_id, null]])
    })
  },
})
