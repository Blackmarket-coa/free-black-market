import fs from "fs"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CreatorProgramType } from "../../src/modules/creator-program/models/creator-program"
import { DEMAND_POOL_MODULE } from "../../src/modules/demand-pool"
import type DemandPoolModuleService from "../../src/modules/demand-pool/service"
import { HAWALA_LEDGER_MODULE } from "../../src/modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../src/modules/hawala-ledger/service"
import { FUNDED_LAUNCHES_FLAG } from "../../src/modules/hawala-ledger/vendor-transfer-switches"
import { getCollectiveHawalaService } from "../../src/services/collective-hawala"
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
 * **Funded launches.** A bounty amount or a sponsorship amount is refused at
 * the route, and the escrow methods refuse in the service layer, unless
 * `FBM_FUNDED_LAUNCHES_LIVE=1`. Their escrow debits a `USER_WALLET` no seller
 * has, so the workflow failed; a failure used to leave the post open with an
 * unescrowed bounty and a deleted product, and the route then answered
 * `idempotent: true` for that slug on every retry. With a wallet (a fixture),
 * the money moved into escrow with no payout and no refund.
 *
 * **Milestones.** Percentages that do not sum to 100 are refused at the route;
 * a failure anywhere in the bounty step cancels the post it made.
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
    const hawala = () => getContainer().resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    const pg = () => getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)

    afterEach(() => {
      delete process.env[FUNDED_LAUNCHES_FLAG]
    })

    /** A seller USER_WALLET holding `dollars`: a fixture, since nothing in the app makes one for a seller. */
    async function sellerWallet(sellerId: string, dollars: number) {
      const account = await hawala().createAccount({
        account_type: "USER_WALLET",
        owner_type: "SELLER",
        owner_id: sellerId,
        currency_code: "USD",
      })
      await pg().raw(`UPDATE hawala_ledger_account SET balance = ?, available_balance = ? WHERE id = ?`, [
        dollars,
        dollars,
        account.id,
      ])
    }

    /** Accounts whose owner starts with one of these, as `owner|type` -> dollars. */
    async function accountsOf(...ownerPrefixes: string[]) {
      const { rows } = await pg().raw(
        `SELECT owner_id, account_type, available_balance::text AS available FROM hawala_ledger_account
          WHERE owner_id LIKE ANY(?) ORDER BY owner_id, account_type`,
        [ownerPrefixes.map((prefix) => `${prefix}%`)]
      )
      return Object.fromEntries(
        rows.map((r: { owner_id: string; account_type: string; available: string }) => [
          `${r.owner_id}|${r.account_type}`,
          Number(r.available),
        ])
      )
    }

    const programCount = async (slug: string) =>
      Number((await pg().raw(`SELECT count(*)::int AS n FROM creator_program WHERE slug = ?`, [slug])).rows[0].n)

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

      type Milestone = { description: string; percentage: number; condition: string }

      /** The launch workflow run directly, as a caller that skips the route would run it. */
      async function runLaunch(
        sellerId: string,
        title: string,
        slug: string,
        bounty: { amount: number; milestones?: Milestone[] }
      ) {
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
            bounty: { objective: "RECRUIT_BUYERS", amount: bounty.amount, currency_code: "USD", milestones: bounty.milestones },
            program: { title: `${title} creators`, slug, program_type: CreatorProgramType.AFFILIATE_OPEN },
          },
          throwOnError: false,
        })
        return { launchId, errors: errors.map((e) => e.error?.message) }
      }

      /**
       * A funded launch with funded launches switched on, run as the first
       * review ran it: the escrow throws for want of a seller wallet.
       */
      async function failedFundedLaunch(sellerId: string, title: string, slug: string) {
        process.env[FUNDED_LAUNCHES_FLAG] = "1"
        try {
          const { launchId, errors } = await runLaunch(sellerId, title, slug, { amount: 50 })
          expect(errors).toEqual(["Contributor wallet not found"])
          return launchId
        } finally {
          delete process.env[FUNDED_LAUNCHES_FLAG]
        }
      }

      it("whose bounty escrow fails leaves no public bounty behind: the post and the bounty are cancelled, the product is gone", async () => {
        await makeStore()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const id = uid()
        const launchId = await failedFundedLaunch(seller.seller.id, `Seed mix ${id}`, `seed-mix-${id}`)

        const posts = await demandOf(launchId)
        expect(posts).toEqual([
          {
            id: expect.any(String),
            status: "CANCELLED",
            product_id: expect.any(String),
            bounties: [{ id: expect.any(String), status: "CANCELLED", escrowed: false, milestones: null }],
          },
        ])
        expect(await storedProducts({ title: `Seed mix ${id}` })).toEqual([])
        // The wallet was checked before the pool's escrow account was made.
        expect(await accountsOf(`demand-pool-${posts[0].id}`)).toEqual({})
      })

      it("with a funded bounty is refused in the service while funded launches are off, though the seller has a wallet, and moves the money once they are on", async () => {
        await makeStore()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        await sellerWallet(seller.seller.id, 200)
        const id = uid()

        // The workflow called directly (the route already refuses): the
        // second review saw it escrow 50 with no switch.
        const off = await runLaunch(seller.seller.id, `Seed mix ${id}`, `seed-mix-${id}`, { amount: 50 })
        expect(off.errors).toEqual(["Funded launches are not available (FBM_FUNDED_LAUNCHES_LIVE is not on)"])
        expect(await demandOf(off.launchId)).toEqual([])
        expect(await storedProducts({ title: `Seed mix ${id}` })).toEqual([])
        expect(await accountsOf(seller.seller.id, "demand-pool-")).toEqual({ [`${seller.seller.id}|USER_WALLET`]: 200 })

        // On: the same launch escrows the 50, so the switch is what stops it.
        process.env[FUNDED_LAUNCHES_FLAG] = "1"
        const on = await runLaunch(seller.seller.id, `Seed mix ${id}`, `seed-mix-${id}`, { amount: 50 })
        expect(on.errors).toEqual([])
        const [post] = await demandOf(on.launchId)
        expect(post).toMatchObject({ status: "OPEN", bounties: [{ status: "ACTIVE", escrowed: true }] })
        expect(await accountsOf(seller.seller.id, "demand-pool-")).toEqual({
          [`${seller.seller.id}|USER_WALLET`]: 150,
          [`demand-pool-${post.id}|ESCROW`]: 50,
        })
      })

      it("with milestones that do not sum to 100 is refused at the route, before anything is written", async () => {
        await makeStore()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const id = uid()
        const refused = await safe(
          api.post(
            "/v1/seller/launches",
            {
              title: `Seed mix ${id}`,
              slug: `seed-mix-${id}`,
              price: 800,
              bounty_milestones: [{ description: "Half", percentage: 50, condition: "half done" }],
            },
            authHeader(seller.token)
          )
        )
        expect(refused.status).toBe(400)
        expect(refused.data).toMatchObject({ type: "invalid_request" })
        expect(refused.data.errors.fieldErrors.bounty_milestones).toEqual(["Bounty milestone percentages must sum to 100"])
        expect(await demandOf(`launch_${seller.seller.id}_seed-mix-${id}`)).toEqual([])
        expect(await storedProducts({ title: `Seed mix ${id}` })).toEqual([])
      })

      it("that fails inside the bounty step before any escrow cancels the post it made, and a retry launches", async () => {
        await makeStore()
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const id = uid()

        // Called directly, past the route's check: addBounty refuses.
        const half = [{ description: "Half", percentage: 50, condition: "half done" }]
        const failed = await runLaunch(seller.seller.id, `Seed mix ${id}`, `seed-mix-${id}`, { amount: 0, milestones: half })
        expect(failed.errors).toEqual(["Bounty milestone percentages must sum to 100"])
        // Before: the post stayed OPEN with no bounty, beside a deleted product.
        expect(await demandOf(failed.launchId)).toEqual([
          { id: expect.any(String), status: "CANCELLED", product_id: expect.any(String), bounties: [] },
        ])
        expect(await storedProducts({ title: `Seed mix ${id}` })).toEqual([])

        const whole = [{ description: "All", percentage: 100, condition: "done" }]
        const retried = await runLaunch(seller.seller.id, `Seed mix ${id}`, `seed-mix-${id}`, { amount: 0, milestones: whole })
        expect(retried.errors).toEqual([])
        expect((await demandOf(failed.launchId)).map((post) => [post.status, post.bounties.length]).sort()).toEqual([
          ["CANCELLED", 0],
          ["OPEN", 1],
        ])
      })

      describe("a sponsorship", () => {
        const sponsorship = (id: string, extra: Record<string, unknown> = {}) => ({
          launch_type: "SPONSORSHIP",
          title: `Sponsor ${id}`,
          slug: `sponsor-${id}`,
          sponsorship_amount: 5000,
          ...extra,
        })

        it("with an amount is refused at the route, before anything is written", async () => {
          await makeStore()
          const seller = await createAuthenticatedSeller({ api, getContainer })
          const id = uid()

          // The find-creators page's sponsor button, which always sends an amount.
          const refused = await safe(
            api.post("/v1/seller/launches", sponsorship(id, { target_creator_seller_id: "sel_some_creator" }), authHeader(seller.token))
          )
          expect([refused.status, refused.data]).toEqual([
            400,
            {
              message: "A funded sponsorship is not available yet. Leave the sponsorship amount empty to launch.",
              type: "invalid_request",
            },
          ])
          expect(await programCount(`sponsor-${id}`)).toBe(0)
          expect(await accountsOf(`sponsorship-launch_${seller.seller.id}`)).toEqual({})
        })

        it("and a launch bounty are refused in the service while funded launches are off, before any account is read or made", async () => {
          const seller = `sel_${uid()}`
          const off = "Funded launches are not available (FBM_FUNDED_LAUNCHES_LIVE is not on)"
          const collective = getCollectiveHawalaService(getContainer())
          await expect(
            collective.escrowSponsorshipFunds({ sponsorship_id: `launch_${seller}_x`, producer_id: seller, amount: 50 })
          ).rejects.toThrow(off)
          await expect(
            collective.escrowBountyFunds({ demand_post_id: `dp_${seller}`, bounty_id: `b_${seller}`, contributor_id: seller, amount: 50 })
          ).rejects.toThrow(off)
          expect(await accountsOf(`sponsorship-launch_${seller}`, `demand-pool-dp_${seller}`)).toEqual({})
        })

        it("with funded launches on: no wallet leaves no empty escrow account; a wallet (fixture) moves the money, so the switch is what stops it", async () => {
          await makeStore()
          const seller = await createAuthenticatedSeller({ api, getContainer })
          process.env[FUNDED_LAUNCHES_FLAG] = "1"

          const noWallet = uid()
          const failed = await safe(api.post("/v1/seller/launches", sponsorship(noWallet), authHeader(seller.token)))
          expect([failed.status, failed.data]).toEqual([409, { message: "Producer wallet not found", type: "launch_failed" }])
          // Before: an empty sponsorship-launch_… ESCROW account on every attempt.
          expect(await accountsOf(`sponsorship-launch_${seller.seller.id}`)).toEqual({})

          await sellerWallet(seller.seller.id, 200)
          const funded = uid()
          const ok = await safe(api.post("/v1/seller/launches", sponsorship(funded), authHeader(seller.token)))
          expect({ status: ok.status, body: ok.status === 201 ? null : ok.data }).toEqual({ status: 201, body: null })
          expect(await accountsOf(seller.seller.id, `sponsorship-launch_${seller.seller.id}`)).toEqual({
            [`${seller.seller.id}|USER_WALLET`]: 150,
            [`sponsorship-launch_${seller.seller.id}_sponsor-${funded}|ESCROW`]: 50,
          })
        })
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
