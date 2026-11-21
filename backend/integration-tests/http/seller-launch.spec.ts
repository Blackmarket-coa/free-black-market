import fs from "fs"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CreatorProgramType } from "../../src/modules/creator-program/models/creator-program"
import { DEMAND_POOL_MODULE } from "../../src/modules/demand-pool"
import type DemandPoolModuleService from "../../src/modules/demand-pool/service"
import launchProductWorkflow from "../../src/workflows/launch-product"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { authHeader, createAuthenticatedSeller, ensureStoreInfra, safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * The vendor panel's launches (`POST /v1/seller/launches`), on a database
 * built from the migrations. No launch could succeed there before SD-63's
 * migrations (a launch writes a demand post and a bounty), so nothing had run
 * what a launch then does.
 *
 * **Price.** The route documents `price` as minor units, and the panel sends
 * 1200 for "12.00" (`vendor-panel/src/routes/launch-business/
 * launch-business.tsx`; `find-creators.tsx` sends a PRODUCT launch the same
 * way). Medusa prices are major units, and the route handed the 1200 over
 * as-is: a launch typed at $12.00 published a variant priced 1200, $1,200.00
 * on the storefront. It converts at the route. Read back two ways: the stored
 * variant price, and what the storefront's own product-page query
 * (`storefront/src/lib/data/product-query.ts`, sent as the js-sdk sends it)
 * returns.
 *
 * **Sales channel.** The product goes into the store's default channel, and
 * only that one. The route used to pass `sales_channel_ids`, which
 * `createProductsWorkflow` does not read, so the product reached the default
 * channel only when `subscribers/product-created-sales-channel` linked it a
 * moment later. The store here has an older channel that is not its default,
 * which a "first channel" lookup would pick.
 *
 * **Funded bounty.** Refused at the route. Its escrow debits a `USER_WALLET`
 * no seller has, so the workflow fails; a failure used to leave the post open
 * with an unescrowed bounty and a deleted product, and the route then answered
 * `idempotent: true` for that slug on every retry.
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

type StoredProduct = {
  id: string
  handle: string
  status: string
  sales_channels: Array<{ id: string }>
  variants: Array<{ prices: Array<{ amount: unknown; currency_code: string }> }>
}

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const storefront = loadStorefront()
    const run = storefront ? it : it.skip

    const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const pools = () => getContainer().resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)

    let drainSubscribers: () => Promise<void> = async () => {}
    beforeEach(() => {
      drainSubscribers = trackSubscribers(getContainer)
    })

    /**
     * A store as production has one: an older sales channel that is not the
     * default (the helper's), the store's default channel behind the
     * storefront's publishable key, and a US region in dollars.
     */
    async function makeStore() {
      const container = getContainer()
      const { salesChannelId: olderChannelId } = await ensureStoreInfra(container)
      const [channel] = await container.resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: "Storefront" }])
      const stores = container.resolve(Modules.STORE)
      const [store] = await stores.listStores()
      if (store) {
        await stores.updateStores(store.id, { default_sales_channel_id: channel.id })
      } else {
        await stores.createStores([{ name: "FBM", default_sales_channel_id: channel.id }])
      }
      const [key] = await container
        .resolve(Modules.API_KEY)
        .createApiKeys([{ title: "storefront", type: "publishable", created_by: "test" }])
      await container.resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.API_KEY]: { publishable_key_id: key.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
      })
      const [region] = await container
        .resolve(Modules.REGION)
        .createRegions([{ name: "United States", currency_code: "usd", countries: ["us"] }])
      return { defaultChannelId: channel.id, olderChannelId, pak: { headers: { "x-publishable-api-key": key.token } }, region }
    }

    async function storedProducts(filters: Record<string, unknown>): Promise<StoredProduct[]> {
      const { data } = await getContainer().resolve(ContainerRegistrationKeys.QUERY).graph({
        entity: "product",
        fields: ["id", "handle", "status", "variants.prices.amount", "variants.prices.currency_code", "sales_channels.id"],
        filters,
      })
      // `variants.prices` is a link field the generated product type leaves out.
      return data as unknown as StoredProduct[]
    }

    /** What a launch leaves for `launchId`: each post with its bounties. */
    async function demandOf(launchId: string) {
      const posts = await pools().listDemandPosts({ launch_id: launchId })
      return Promise.all(
        posts.map(async (post) => ({
          id: post.id,
          status: post.status,
          product_id: post.product_id,
          bounties: (await pools().listDemandBounties({ demand_post_id: post.id })).map((b) => ({
            id: b.id,
            status: b.status,
            escrowed: b.escrowed,
            milestones: b.milestones,
          })),
        }))
      )
    }

    describe("a launch", () => {
      afterEach(async () => {
        await drainSubscribers()
        jest.restoreAllMocks()
      })

      run("at $12.00 publishes a $12.00 product, in the store's default sales channel only: stored as 12, and 12 on the storefront's product page", async () => {
        const { defaultChannelId, olderChannelId, pak, region } = await makeStore()
        expect(olderChannelId).not.toBe(defaultChannelId)
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const id = uid()

        // The panel's request for a product typed at "12.00", built as
        // launch-business.tsx builds it.
        const typed = "12.00"
        const launched = await safe(
          api.post(
            "/v1/seller/launches",
            {
              launch_type: "BUSINESS",
              title: `Compost ${id}`,
              slug: `compost-${id}`,
              price: Math.round(parseFloat(typed) * 100),
              business: { producer_name: `Sunrise Farm ${id}`, producer_handle: `sunrise-${id}` },
            },
            authHeader(seller.token)
          )
        )
        expect({ status: launched.status, body: launched.status === 201 ? null : launched.data }).toEqual({ status: 201, body: null })
        const productId: string = launched.data.launch.product_id

        // Stored: Medusa's price is 12, in major units. The channel is read
        // once every subscriber the launch set off has run, the one that
        // links new products to the default channel among them.
        await drainSubscribers()
        const [product] = await storedProducts({ id: productId })
        expect(product.status).toBe("published")
        expect(product.sales_channels.map((c) => c.id)).toEqual([defaultChannelId])
        expect(product.variants).toHaveLength(1)
        expect(product.variants[0].prices.map((p) => [Number(p.amount), p.currency_code])).toEqual([[12, "usd"]])

        // The storefront: its product page asks for the price in the region.
        const page = await safe(
          api.get(
            `/store/products?${toQueryString(storefront!.productPageQuery({ handle: product.handle, regionId: region.id, countryCode: "us" }))}`,
            pak
          )
        )
        expect(page.status).toBe(200)
        expect(page.data.products.map((p: { id: string }) => p.id)).toEqual([productId])
        expect(page.data.products[0].variants[0].calculated_price).toMatchObject({
          calculated_amount: 12,
          original_amount: 12,
          currency_code: "usd",
        })

        // The rest of the launch landed: its demand post, and its bounty with
        // no milestones (the panel sends none).
        expect(await demandOf(launched.data.launch.launch_id)).toEqual([
          {
            id: launched.data.launch.demand_post_id,
            status: "OPEN",
            product_id: productId,
            bounties: [{ id: launched.data.launch.bounty_id, status: "ACTIVE", escrowed: false, milestones: null }],
          },
        ])
      })

      it("with a bounty amount is refused before anything is written", async () => {
        await makeStore()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const id = uid()

        // The find-creators page's request, with the bounty field filled in.
        const refused = await safe(
          api.post(
            "/v1/seller/launches",
            {
              title: `Seed mix ${id}`,
              slug: `seed-mix-${id}`,
              price: 800,
              target_creator_seller_id: "sel_some_creator",
              bounty_amount: 50,
              bounty_objective: "CREATOR_NEEDED",
            },
            authHeader(seller.token)
          )
        )
        expect([refused.status, refused.data]).toEqual([
          400,
          { message: "A funded bounty is not available yet. Leave the bounty amount empty to launch.", type: "invalid_request" },
        ])
        expect(await demandOf(`launch_${seller.seller.id}_seed-mix-${id}`)).toEqual([])
        expect(await storedProducts({ title: `Seed mix ${id}` })).toEqual([])
      })

      /**
       * The launch workflow with a funded bounty, run as the review ran it:
       * the escrow throws for want of a seller wallet.
       */
      async function failedFundedLaunch(sellerId: string, title: string, slug: string) {
        const launchId = `launch_${sellerId}_${slug}`
        const { errors } = await launchProductWorkflow(getContainer()).run({
          input: {
            launch_id: launchId,
            seller_id: sellerId,
            product: {
              title,
              status: "published",
              options: [{ title: "Default option", values: ["Default"] }],
              variants: [
                {
                  title: "Default",
                  manage_inventory: false,
                  prices: [{ amount: 8, currency_code: "usd" }],
                  options: { "Default option": "Default" },
                },
              ],
              metadata: { launch_id: launchId },
            },
            demand: { title: `${title} — marketing bounty`, description: "Promote it.", target_quantity: 100, min_quantity: 1 },
            bounty: { objective: "RECRUIT_BUYERS", amount: 50, currency_code: "USD" },
            program: { title: `${title} creators`, slug, program_type: CreatorProgramType.AFFILIATE_OPEN },
          },
          throwOnError: false,
        })
        expect(errors.map((e) => e.error?.message)).toEqual(["Contributor wallet not found"])
        return launchId
      }

      it("whose bounty escrow fails leaves no public bounty behind: the post and the bounty are cancelled, the product is gone", async () => {
        await makeStore()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const id = uid()
        const launchId = await failedFundedLaunch(seller.seller.id, `Seed mix ${id}`, `seed-mix-${id}`)

        expect(await demandOf(launchId)).toEqual([
          {
            id: expect.any(String),
            status: "CANCELLED",
            product_id: expect.any(String),
            bounties: [{ id: expect.any(String), status: "CANCELLED", escrowed: false, milestones: null }],
          },
        ])
        expect(await storedProducts({ title: `Seed mix ${id}` })).toEqual([])
      })

      it("that failed once can be made: its slug launches, and only a launch whose product exists answers idempotent", async () => {
        const { defaultChannelId } = await makeStore()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const id = uid()
        const launchId = await failedFundedLaunch(seller.seller.id, `Seed mix ${id}`, `seed-mix-${id}`)
        const body = { title: `Seed mix ${id}`, slug: `seed-mix-${id}`, price: 800 }

        const retried = await safe(api.post("/v1/seller/launches", body, authHeader(seller.token)))
        expect({ status: retried.status, body: retried.status === 201 ? null : retried.data }).toEqual({ status: 201, body: null })
        expect(retried.data.idempotent).toBeUndefined()
        await drainSubscribers()
        const [product] = await storedProducts({ id: retried.data.launch.product_id })
        expect(product.sales_channels.map((c) => c.id)).toEqual([defaultChannelId])
        expect(product.variants[0].prices.map((p) => [Number(p.amount), p.currency_code])).toEqual([[8, "usd"]])

        // The same request again is the launch that now exists, not the debris before it.
        const again = await safe(api.post("/v1/seller/launches", body, authHeader(seller.token)))
        expect([again.status, again.data]).toEqual([
          200,
          {
            launch: {
              launch_id: launchId,
              product_id: product.id,
              demand_post_id: retried.data.launch.demand_post_id,
              cooperative_id: null,
              bounty_id: retried.data.launch.bounty_id,
            },
            idempotent: true,
          },
        ])
        expect((await demandOf(launchId)).map((post) => [post.status, post.product_id === product.id])).toEqual(
          expect.arrayContaining([
            ["CANCELLED", false],
            ["OPEN", true],
          ])
        )
        expect(await demandOf(launchId)).toHaveLength(2)
      })
    })
  },
})
