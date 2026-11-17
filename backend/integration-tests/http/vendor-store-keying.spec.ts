import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow, deleteMemberWorkflow } from "@mercurjs/b2c-core/workflows"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../../src/modules/accounts-receivable"
import { DEMAND_POOL_MODULE } from "../../src/modules/demand-pool"
import { FUND_ACCOUNTING_MODULE } from "../../src/modules/fund-accounting"
import { ORDER_CYCLE_MODULE } from "../../src/modules/order-cycle"
import PrintfulClient from "../../src/modules/printful-fulfillment/client"
import { SUPPLIER_FORWARDING_MODULE } from "../../src/modules/supplier-forwarding"
import { VENDOR_RULES_MODULE } from "../../src/modules/vendor-rules"
import rekeyScript, {
  HELD_FOR_DECISION,
  REKEY_TARGETS,
  rekeyMemberKeyedStoreData,
  type RekeySummary,
  type TargetReport,
} from "../../src/scripts/rekey-member-keyed-store-data"
import { assignSellerPlan } from "./helpers/seller-auth"
import { newTestPassword } from "./helpers/test-password"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(300 * 1000)

/**
 * Vendor routes key store data by the store the vendor gate resolved, not by
 * the member who called (SD-145), on the real server and a migrated database.
 *
 * Behind the vendor gate `auth_context.actor_id` is a member id for every
 * vendor: Mercur links a login to a member, and the gate turns a seller-id
 * actor into its member. About ninety vendor routes read it as the store id,
 * so a store's records belonged to whichever member made them. Traced by
 * reading before the fix: tiers made in the panel never reached the
 * wholesale cart (it reads them by the product's seller), a manual fulfilment
 * was refused for every order, imported products belonged to no store, and an
 * order cycle, a fee or a fund could be managed only by the member who made it.
 *
 * Each store here is made the way approval makes one (Mercur's
 * createSellerWorkflow links its owner's login to the owner member) with a
 * second member whose login is linked to its own member row, as an accepted
 * invite leaves it; so every actor is a real member id. Store A's two members
 * sign in through Medusa's own route once; other tokens carry the claims
 * Medusa mints. Members are removed with Mercur's deleteMemberWorkflow.
 *
 * The last block runs scripts/rekey-member-keyed-store-data.ts on rows
 * written under member ids, an active member's and a removed member's.
 */

medusaIntegrationTestRunner({
  inApp: true,
  env: { FF_FUND_ACCOUNTING_V1: "true" },
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)
    const query = () => container().resolve(ContainerRegistrationKeys.QUERY)
    const pg = () => container().resolve(ContainerRegistrationKeys.PG_CONNECTION)

    type Login = { email: string; password: string; authIdentityId: string }
    type Member = Login & { memberId: string; token: string }
    type Team = { store: { id: string; name: string }; owner: Member; member: Member }

    /** A login made through the auth module, so it spends none of the auth limiter. */
    async function plainLogin(prefix: string): Promise<Login> {
      const email = `${prefix}-${uid()}@example.com`
      const password = newTestPassword(prefix)
      const auth = container().resolve(Modules.AUTH)
      await auth.register("emailpass", { body: { email, password } } as any)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      return { email, password, authIdentityId: provider.auth_identity_id as string }
    }

    /** The claims Medusa mints at sign-in: the login's linked member as the actor. */
    const tokenFor = (who: Login, memberId: string) =>
      jwt.sign(
        {
          actor_id: memberId,
          actor_type: "seller",
          auth_identity_id: who.authIdentityId,
          auth_provider: "emailpass",
          app_metadata: { seller_id: memberId },
          user_metadata: {},
        },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      )

    /** Medusa's own sign-in. Spends one of the auth limiter's 20 a minute. */
    async function signIn(who: Login): Promise<string> {
      const res = await api.post("/auth/seller/emailpass", { email: who.email, password: who.password })
      return res.data.token as string
    }

    /** A login linked to a new member row of the store, as an accepted invite leaves one. */
    async function teamMember(storeId: string, prefix: string): Promise<Login & { memberId: string }> {
      const login = await plainLogin(prefix)
      const [member] = await container()
        .resolve(SELLER_MODULE)
        .createMembers([{ seller_id: storeId, name: prefix, email: login.email, role: "member" }])
      await container()
        .resolve(Modules.AUTH)
        .updateAuthIdentities([{ id: login.authIdentityId, app_metadata: { seller_id: member.id } }])
      return { ...login, memberId: member.id as string }
    }

    /** A store made the way approval makes one, its owner, and a second member. */
    async function team(name: string, opts: { realSignIn?: boolean } = {}): Promise<Team> {
      const ownerLogin = await plainLogin("owner")
      const { result: store } = await createSellerWorkflow.run({
        container: container(),
        input: {
          auth_identity_id: ownerLogin.authIdentityId,
          member: { name: "Owner", email: ownerLogin.email },
          seller: { name },
        } as any,
      })
      const [ownerMember] = await container().resolve(SELLER_MODULE).listMembers({ seller_id: store.id })
      await assignSellerPlan(container(), store.id, "internal")
      const memberLogin = await teamMember(store.id, "member")
      const owner: Member = {
        ...ownerLogin,
        memberId: ownerMember.id as string,
        token: opts.realSignIn ? await signIn(ownerLogin) : tokenFor(ownerLogin, ownerMember.id),
      }
      const member: Member = {
        ...memberLogin,
        token: opts.realSignIn ? await signIn(memberLogin) : tokenFor(memberLogin, memberLogin.memberId),
      }
      if (opts.realSignIn) {
        // What Medusa minted: each login acts as its own member, never the store.
        expect(jwt.decode(owner.token)).toMatchObject({ actor_id: owner.memberId })
        expect(jwt.decode(member.token)).toMatchObject({ actor_id: member.memberId })
      }
      return { store: store as { id: string; name: string }, owner, member }
    }

    /** A published product of the store, one variant. */
    async function productOf(storeId: string) {
      const product = await bareProduct()
      await link().create({ [SELLER_MODULE]: { seller_id: storeId }, [Modules.PRODUCT]: { product_id: product.id } })
      return product
    }

    /** A published product, one variant, linked to nobody yet. */
    async function bareProduct() {
      const id = uid()
      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([
          {
            title: `Tomatoes ${id}`,
            handle: `tomatoes-${id}`,
            status: "published",
            options: [{ title: "Size", values: ["Crate"] }],
            variants: [{ title: "Crate", manage_inventory: false, options: { Size: "Crate" } }],
          },
        ])
      return product as { id: string; title: string; variants: Array<{ id: string }> }
    }

    /** An order for one of the store's products, linked to the store. */
    async function orderOf(storeId: string, product: { id: string; title: string }) {
      const [order] = await container()
        .resolve(Modules.ORDER)
        .createOrders([
          {
            currency_code: "usd",
            email: "buyer@example.com",
            items: [{ title: product.title, product_id: product.id, quantity: 1, unit_price: 10 }],
          },
        ])
      await link().create({ [SELLER_MODULE]: { seller_id: storeId }, [Modules.ORDER]: { order_id: order.id } })
      return order as { id: string }
    }

    beforeAll(async () => {
      // A fixture, not FBM's behaviour (SD-63): on a database built from the
      // migrations these two tables lack the raw_* companions Medusa writes
      // for their bigNumber fields, so no insert into them can work at all
      // (module-schema-drift.spec.ts lists them in KNOWN_DRIFT). The keying
      // checked here is independent of that; without the columns,
      // POST /vendor/enterprise-fees answers 500 for every caller.
      await pg().raw(`
        ALTER TABLE "enterprise_fee" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB NULL;
        ALTER TABLE "demand_post"
          ADD COLUMN IF NOT EXISTS "raw_final_total_price" JSONB NULL,
          ADD COLUMN IF NOT EXISTS "raw_final_unit_price" JSONB NULL,
          ADD COLUMN IF NOT EXISTS "raw_target_price" JSONB NULL,
          ADD COLUMN IF NOT EXISTS "raw_total_bounty_amount" JSONB NULL,
          ADD COLUMN IF NOT EXISTS "raw_total_escrowed" JSONB NULL;
      `)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    describe("(a) customer tiers", () => {
      it("a tier the owner makes in the panel applies at the store's wholesale cart, and the other member manages it", async () => {
        const a = await team(`Tier Farm ${uid()}`, { realSignIn: true })
        const b = await team(`Other Farm ${uid()}`)

        // The storefront side: a region, a publishable key's sales channel, a
        // product of store A priced 10.00, and a buyer.
        const { result: regions } = await createRegionsWorkflow(container()).run({
          input: { regions: [{ name: `United States ${uid()}`, currency_code: "usd", countries: ["us"] }] },
        })
        const pakToken = await createPublishableKeyToken(getContainer)
        const pak = pakHeaders(pakToken)
        const { data: keys } = await query().graph({ entity: "api_key", fields: ["id", "sales_channels.id"], filters: { token: pakToken } })
        const salesChannelId: string = keys[0].sales_channels[0].id
        const product = await productOf(a.store.id)
        await link().create({ [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId } })
        const [priceSet] = await container().resolve(Modules.PRICING).createPriceSets([{ prices: [{ amount: 10, currency_code: "usd" }] }])
        await link().create({ [Modules.PRODUCT]: { variant_id: product.variants[0].id }, [Modules.PRICING]: { price_set_id: priceSet.id } })
        const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `buyer-${uid()}@example.com` }])

        const created = await call(
          api.post(
            "/vendor/customer-tiers",
            { name: "Wholesale", tier_type: "WHOLESALE", discount_percent: 20, waive_order_minimum: true, customer_ids: [customer.id] },
            bearer(a.owner.token)
          )
        )
        expect(created.status).toBe(201)
        // Keyed by the store the gate resolved, not by the owner's member id.
        expect(created.data.tier.seller_id).toBe(a.store.id)
        const tierId: string = created.data.tier.id

        // The store's other member lists it and edits it.
        const listed = await api.get("/vendor/customer-tiers", bearer(a.member.token))
        expect(listed.data.tiers.map((t: { id: string }) => t.id)).toContain(tierId)
        const edited = await call(api.patch(`/vendor/customer-tiers/${tierId}`, { description: "Net-30 for restaurants" }, bearer(a.member.token)))
        expect(edited.status).toBe(200)
        expect(edited.data.tier.description).toBe("Net-30 for restaurants")

        // Another store neither lists nor reads it.
        const foreignList = await api.get("/vendor/customer-tiers", bearer(b.owner.token))
        expect(foreignList.data.tiers.map((t: { id: string }) => t.id)).not.toContain(tierId)
        const foreignRead = await call(api.get(`/vendor/customer-tiers/${tierId}`, bearer(b.owner.token)))
        expect(foreignRead.status).toBe(404)

        // The wholesale cart reads tiers by product.seller.id: the tier applies.
        const [cart] = await container()
          .resolve(Modules.CART)
          .createCarts([
            {
              currency_code: "usd",
              region_id: regions[0].id,
              sales_channel_id: salesChannelId,
              email: customer.email,
              customer_id: customer.id,
              items: [{ title: product.title, product_id: product.id, variant_id: product.variants[0].id, quantity: 1, unit_price: 10 }],
            },
          ])
        const applied = await call(api.post(`/store/carts/${cart.id}/wholesale`, {}, pak))
        expect({ status: applied.status, data: applied.data }).toMatchObject({
          status: 200,
          data: { cart_id: cart.id, applied: true, line_items_repriced: 1, sellers: [a.store.id] },
        })
        const items = await container().resolve(Modules.CART).listLineItems({ cart_id: cart.id }, { select: ["id", "unit_price"] })
        expect(items.map((i: { unit_price: unknown }) => Number(i.unit_price))).toEqual([8])
      })
    })

    describe("(c) manual fulfilment", () => {
      it("both members drive the store's own order; another store's order is still refused", async () => {
        const a = await team(`Ship Farm ${uid()}`)
        const b = await team(`Far Farm ${uid()}`)
        const ownOrder = await orderOf(a.store.id, await productOf(a.store.id))
        const otherOrder = await orderOf(b.store.id, await productOf(b.store.id))
        const updatesOf = async (orderId: string) =>
          container().resolve(SUPPLIER_FORWARDING_MODULE).listManualFulfillmentUpdates({ order_id: orderId })

        for (const [who, token] of [["owner", a.owner.token], ["member", a.member.token]] as const) {
          const read = await call(api.get(`/vendor/orders/${ownOrder.id}/manual-fulfillment`, bearer(token)))
          expect({ who, status: read.status }).toEqual({ who, status: 200 })
        }
        const acknowledged = await call(
          api.post(`/vendor/orders/${ownOrder.id}/manual-fulfillment`, { supplier_id: "sup_keying", next_status: "acknowledged" }, bearer(a.member.token))
        )
        expect(acknowledged.status).toBe(201)
        const started = await call(
          api.post(`/vendor/orders/${ownOrder.id}/manual-fulfillment`, { supplier_id: "sup_keying", next_status: "in_progress" }, bearer(a.owner.token))
        )
        expect(started.status).toBe(201)
        expect((await updatesOf(ownOrder.id)).map((u: { status: string }) => u.status).sort()).toEqual(["acknowledged", "in_progress"])

        // Another store's order: refused both ways, with nothing written.
        const foreignRead = await call(api.get(`/vendor/orders/${otherOrder.id}/manual-fulfillment`, bearer(a.owner.token)))
        expect(foreignRead.status).toBe(403)
        const foreignWrite = await call(
          api.post(`/vendor/orders/${otherOrder.id}/manual-fulfillment`, { supplier_id: "sup_keying", next_status: "acknowledged" }, bearer(a.member.token))
        )
        expect(foreignWrite.status).toBe(403)
        expect(await updatesOf(otherOrder.id)).toEqual([])
        const fromOtherStore = await call(api.get(`/vendor/orders/${ownOrder.id}/manual-fulfillment`, bearer(b.owner.token)))
        expect(fromOtherStore.status).toBe(403)
      })
    })

    describe("(d) order cycles and enterprise fees", () => {
      it("a cycle and a fee one member makes are listed and managed by the other member, and by no other store", async () => {
        const a = await team(`Cycle Farm ${uid()}`)
        const b = await team(`Rival Farm ${uid()}`)
        const day = 24 * 60 * 60 * 1000

        const cycle = await call(
          api.post(
            "/vendor/order-cycles",
            { name: `Cycle ${uid()}`, opens_at: new Date(Date.now() + day).toISOString(), closes_at: new Date(Date.now() + 3 * day).toISOString() },
            bearer(a.owner.token)
          )
        )
        expect(cycle.status).toBe(201)
        expect(cycle.data.order_cycle.coordinator_seller_id).toBe(a.store.id)
        const cycleId: string = cycle.data.order_cycle.id

        const memberList = await api.get("/vendor/order-cycles", bearer(a.member.token))
        expect(memberList.data.order_cycles.map((c: { id: string }) => c.id)).toContain(cycleId)
        const memberRead = await call(api.get(`/vendor/order-cycles/${cycleId}`, bearer(a.member.token)))
        expect(memberRead.status).toBe(200)
        const renamed = await call(api.put(`/vendor/order-cycles/${cycleId}`, { name: "Renamed by the member" }, bearer(a.member.token)))
        expect(renamed.status).toBe(200)
        expect(renamed.data.order_cycle.name).toBe("Renamed by the member")

        const rivalList = await api.get("/vendor/order-cycles", bearer(b.owner.token))
        expect(rivalList.data.order_cycles.map((c: { id: string }) => c.id)).not.toContain(cycleId)
        for (const [verb, res] of [
          ["GET", await call(api.get(`/vendor/order-cycles/${cycleId}`, bearer(b.owner.token)))],
          ["PUT", await call(api.put(`/vendor/order-cycles/${cycleId}`, { name: "Taken" }, bearer(b.owner.token)))],
          ["DELETE", await call(api.delete(`/vendor/order-cycles/${cycleId}`, bearer(b.member.token)))],
        ] as const) {
          expect({ verb, status: res.status }).toEqual({ verb, status: 403 })
        }
        const [stillThere] = await container().resolve(ORDER_CYCLE_MODULE).listOrderCycles({ id: cycleId })
        expect(stillThere).toMatchObject({ id: cycleId, name: "Renamed by the member", coordinator_seller_id: a.store.id })

        const fee = await call(
          api.post(
            "/vendor/enterprise-fees",
            { name: `Packing ${uid()}`, fee_type: "packing", calculator_type: "flat_rate", amount: 2 },
            bearer(a.member.token)
          )
        )
        expect(fee.status).toBe(201)
        expect(fee.data.enterprise_fee.seller_id).toBe(a.store.id)
        const feeId: string = fee.data.enterprise_fee.id

        const ownerFees = await api.get("/vendor/enterprise-fees", bearer(a.owner.token))
        expect(ownerFees.data.enterprise_fees.map((f: { id: string }) => f.id)).toContain(feeId)
        const ownerRead = await call(api.get(`/vendor/enterprise-fees/${feeId}`, bearer(a.owner.token)))
        expect(ownerRead.status).toBe(200)
        // The route passes every field through to the update, so it is sent whole.
        const repriced = await call(
          api.put(
            `/vendor/enterprise-fees/${feeId}`,
            { name: fee.data.enterprise_fee.name, fee_type: "packing", calculator_type: "flat_rate", amount: 3, currency_code: "usd", is_active: true },
            bearer(a.owner.token)
          )
        )
        expect({ status: repriced.status, body: repriced.data }).toMatchObject({ status: 200 })

        const rivalFees = await api.get("/vendor/enterprise-fees", bearer(b.owner.token))
        expect(rivalFees.data.enterprise_fees.map((f: { id: string }) => f.id)).not.toContain(feeId)
        for (const [verb, res] of [
          ["GET", await call(api.get(`/vendor/enterprise-fees/${feeId}`, bearer(b.owner.token)))],
          ["PUT", await call(api.put(`/vendor/enterprise-fees/${feeId}`, { amount: 99 }, bearer(b.owner.token)))],
          ["DELETE", await call(api.delete(`/vendor/enterprise-fees/${feeId}`, bearer(b.member.token)))],
        ] as const) {
          expect({ verb, status: res.status }).toEqual({ verb, status: 403 })
        }
        const kept = await container().resolve(ORDER_CYCLE_MODULE).retrieveEnterpriseFee(feeId)
        expect(Number(kept.amount)).toBe(3)

        const deleted = await call(api.delete(`/vendor/enterprise-fees/${feeId}`, bearer(a.owner.token)))
        expect(deleted.status).toBe(200)
      })
    })

    describe("a route that reads getSellerId", () => {
      it("a fund the owner opens is the other member's to read and post to, and no other store's", async () => {
        const a = await team(`Fund Farm ${uid()}`)
        const b = await team(`Grant Farm ${uid()}`)

        const opened = await call(api.post("/vendor/funds", { name: "Farm to School", code: `F2S-${uid()}` }, bearer(a.owner.token)))
        expect(opened.status).toBe(201)
        expect(opened.data.fund.seller_id).toBe(a.store.id)
        const fundId: string = opened.data.fund.id

        const memberFunds = await api.get("/vendor/funds", bearer(a.member.token))
        expect(memberFunds.data.funds.map((f: { id: string }) => f.id)).toContain(fundId)
        // An award moves no money and needs no ledger entry.
        const award = await call(api.post(`/vendor/funds/${fundId}/entries`, { entry_type: "award", amount_cents: 50000 }, bearer(a.member.token)))
        expect(award.status).toBe(201)
        expect(award.data.fund_transaction.seller_id).toBe(a.store.id)
        const report = await call(api.get(`/vendor/funds/${fundId}/report`, bearer(a.member.token)))
        expect(report.status).toBe(200)

        const rivalFunds = await api.get("/vendor/funds", bearer(b.owner.token))
        expect(rivalFunds.data.funds.map((f: { id: string }) => f.id)).not.toContain(fundId)
        const rivalReport = await call(api.get(`/vendor/funds/${fundId}/report`, bearer(b.owner.token)))
        expect(rivalReport.status).toBe(404)
        const rivalEntry = await call(api.post(`/vendor/funds/${fundId}/entries`, { entry_type: "award", amount_cents: 1 }, bearer(b.member.token)))
        expect(rivalEntry.status).toBe(404)
        const entries = await container().resolve(FUND_ACCOUNTING_MODULE).listFundTransactions({ fund_id: fundId })
        expect(entries.map((e: { seller_id: string }) => e.seller_id)).toEqual([a.store.id])
      })
    })

    describe("(b) imports", () => {
      it("a Printful import by a member links the products to the store, with Printful's API stubbed", async () => {
        const a = await team(`Print Shop ${uid()}`)
        const printfulId = Number(String(Date.now()).slice(-8))
        const fetched = jest
          .spyOn(PrintfulClient.prototype, "getCatalogProduct")
          .mockImplementation(async (id: string | number) => ({ id: Number(id), title: `Printful Tee ${id}`, variants: [{ id: 4011 }] }))
        const saved = process.env.PRINTFUL_API_KEY
        process.env.PRINTFUL_API_KEY = "printful-key-for-tests-only"
        let res: any
        try {
          res = await call(api.post("/vendor/printful/import", { product_ids: [printfulId], import_as_draft: true }, bearer(a.member.token)))
        } finally {
          if (saved === undefined) delete process.env.PRINTFUL_API_KEY
          else process.env.PRINTFUL_API_KEY = saved
        }
        expect(res.status).toBe(200)
        expect(res.data.result).toMatchObject({ imported: 1, failed: 0 })
        expect(fetched).toHaveBeenCalledWith(printfulId)
        const productId: string = res.data.products[0].id

        const { data } = await query().graph({ entity: "product", fields: ["id", "seller.id"], filters: { id: productId } })
        expect(data[0].seller?.id).toBe(a.store.id)
        const { rows } = await pg().raw(`SELECT seller_id FROM seller_seller_product_product WHERE product_id = ? AND deleted_at IS NULL`, [productId])
        expect(rows.map((r: { seller_id: string }) => r.seller_id)).toEqual([a.store.id])
      })
    })

    describe("scripts/rekey-member-keyed-store-data.ts", () => {
      const reportOf = (summary: RekeySummary, table: string): TargetReport => {
        const found = summary.targets.find((t) => t.table === table)
        if (!found) throw new Error(`no report for ${table}`)
        return found
      }
      const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id)

      it("reports member-keyed rows on a dry run, rekeys them to the store with apply, leaves clashes and the unknown alone, and a second run finds nothing to do", async () => {
        const s = await team(`Rekey Farm ${uid()}`)
        const owner = s.owner.memberId
        const active = s.member.memberId
        const leaver = await teamMember(s.store.id, "leaver")
        const ghost = `mem_${uid()}_gone`

        // What the routes wrote before SD-145, under the actor's member id.
        const tiers = container().resolve(VENDOR_RULES_MODULE)
        const [activeTier] = await tiers.createVendorCustomerTiers([
          { seller_id: active, name: "Restaurants", tier_type: "WHOLESALE", discount_percent: 10, customer_ids: [] },
        ])
        const [ghostTier] = await tiers.createVendorCustomerTiers([
          { seller_id: ghost, name: "Nobody's", tier_type: "WHOLESALE", discount_percent: 10, customer_ids: [] },
        ])
        const cycles = container().resolve(ORDER_CYCLE_MODULE)
        const leaverFee = await cycles.createEnterpriseFees({
          seller_id: leaver.memberId,
          name: "Leaver's packing fee",
          fee_type: "packing",
          calculator_type: "flat_rate",
          amount: 1,
          currency_code: "usd",
        })
        const day = 24 * 60 * 60 * 1000
        const leaverCycle = await cycles.createOrderCycles({
          name: "Leaver's cycle",
          opens_at: new Date(Date.now() + day),
          closes_at: new Date(Date.now() + 2 * day),
          dispatch_at: new Date(Date.now() + 2 * day),
          status: "draft",
          coordinator_seller_id: leaver.memberId,
        })
        const ar = container().resolve(ACCOUNTS_RECEIVABLE_MODULE)
        // Invoice numbers run per seller, so two members each made INV-00001.
        const ownerFirst = await ar.createDraft({ sellerId: owner, totalCents: 1000 })
        const activeFirst = await ar.createDraft({ sellerId: active, totalCents: 500 })
        const ownerSecond = await ar.createDraft({ sellerId: owner, totalCents: 700 })
        expect([ownerFirst.invoice_number, activeFirst.invoice_number, ownerSecond.invoice_number]).toEqual(["INV-00001", "INV-00001", "INV-00002"])
        const [clashedPayment] = await ar.createInvoicePayments([
          { invoice_id: ownerFirst.id, seller_id: owner, amount: 100, received_at: new Date(), idempotency_key: `pay-${uid()}` },
        ])
        const [movedPayment] = await ar.createInvoicePayments([
          { invoice_id: ownerSecond.id, seller_id: owner, amount: 200, received_at: new Date(), idempotency_key: `pay-${uid()}` },
        ])
        // What printful/import and the background imports linked: the product to the member.
        const imported = await bareProduct()
        await link().create({ [SELLER_MODULE]: { seller_id: active }, [Modules.PRODUCT]: { product_id: imported.id } })
        const {
          rows: [importedLink],
        } = await pg().raw(`SELECT id FROM seller_seller_product_product WHERE product_id = ? AND deleted_at IS NULL`, [imported.id])
        const funds = container().resolve(FUND_ACCOUNTING_MODULE)
        const code = `GRANT-${uid()}`
        const ownerFund = await funds.createFunds({ seller_id: owner, name: "Owner's grant", code })
        const leaverFund = await funds.createFunds({ seller_id: leaver.memberId, name: "Leaver's grant", code })
        const otherFund = await funds.createFunds({ seller_id: owner, name: "Second grant", code: `${code}-2` })
        const [leaverEntry] = await funds.createFundTransactions([
          { seller_id: leaver.memberId, fund_id: leaverFund.id, entry_type: "award", amount_cents: 100, occurred_at: new Date() },
        ])
        const [otherEntry] = await funds.createFundTransactions([
          { seller_id: owner, fund_id: otherFund.id, entry_type: "award", amount_cents: 300, occurred_at: new Date() },
        ])
        // Held: a pool whose selection names a member id decides an escrow payee.
        const [pool] = await container()
          .resolve(DEMAND_POOL_MODULE)
          .createDemandPosts([{ creator_id: `cus_${uid()}`, title: "Bulk oats", description: "Oats", target_quantity: 100, min_quantity: 10, selected_supplier_id: active }])

        // The leaver is removed after writing; its rows still belong to the store.
        await deleteMemberWorkflow.run({ container: container(), input: leaver.memberId })

        const snapshot = async () => ({
          tiers: (await tiers.listVendorCustomerTiers({ id: [activeTier.id, ghostTier.id] })).map((t: any) => [t.id, t.seller_id]).sort(),
          fee: (await cycles.retrieveEnterpriseFee(leaverFee.id)).seller_id,
          cycle: (await cycles.retrieveOrderCycle(leaverCycle.id)).coordinator_seller_id,
          invoices: (await ar.listInvoices({ id: [ownerFirst.id, activeFirst.id, ownerSecond.id] })).map((i: any) => [i.id, i.seller_id]).sort(),
          payments: (await ar.listInvoicePayments({ id: [clashedPayment.id, movedPayment.id] })).map((p: any) => [p.id, p.seller_id]).sort(),
          link: (await pg().raw(`SELECT seller_id FROM seller_seller_product_product WHERE id = ?`, [importedLink.id])).rows[0].seller_id,
          funds: (await funds.listFunds({ id: [ownerFund.id, leaverFund.id, otherFund.id] })).map((f: any) => [f.id, f.seller_id]).sort(),
          entries: (await funds.listFundTransactions({ id: [leaverEntry.id, otherEntry.id] })).map((e: any) => [e.id, e.seller_id]).sort(),
          pool: (await container().resolve(DEMAND_POOL_MODULE).listDemandPosts({ id: pool.id }))[0].selected_supplier_id,
        })
        const before = await snapshot()

        // `--apply` never reaches a medusa exec script: refused before anything is read.
        await expect(rekeyScript({ container: container(), args: ["--apply"] } as any)).rejects.toThrow(/refused/)

        const lines: string[] = []
        const dry = await rekeyMemberKeyedStoreData(container(), { apply: false, log: (l) => lines.push(l) })
        expect(await snapshot()).toEqual(before)
        expect(dry.apply).toBe(false)
        // Every listed table and column is in the migrated schema.
        expect(dry.targets.filter((t) => t.status === "missing").map((t) => `${t.table}.${t.column}`)).toEqual([])
        expect(dry.targets.map((t) => t.table)).toEqual(REKEY_TARGETS.map((t) => t.table))
        expect(dry.held.filter((h) => h.status === "missing").map((h) => `${h.table}.${h.column}`)).toEqual([])
        expect(dry.held.map((h) => h.table)).toEqual(HELD_FOR_DECISION.map((h) => h.table))

        const tierReport = reportOf(dry, "vendor_customer_tier")
        expect(ids(tierReport.rekey)).toContain(activeTier.id)
        expect(tierReport.rekey.find((r) => r.id === activeTier.id)).toEqual({ id: activeTier.id, member_id: active, store_id: s.store.id })
        expect(ids(tierReport.unmatched)).toContain(ghostTier.id)
        expect(ids(tierReport.rekey)).not.toContain(ghostTier.id)
        const feeReport = reportOf(dry, "enterprise_fee")
        expect(feeReport.rekey.find((r) => r.id === leaverFee.id)).toEqual({ id: leaverFee.id, member_id: leaver.memberId, store_id: s.store.id })
        expect(feeReport.removedMember).toBeGreaterThanOrEqual(1)
        expect(ids(reportOf(dry, "order_cycle").rekey)).toContain(leaverCycle.id)
        const invoiceReport = reportOf(dry, "ar_invoice")
        expect(ids(invoiceReport.conflicts).sort()).toEqual(expect.arrayContaining([ownerFirst.id, activeFirst.id]))
        expect(invoiceReport.conflicts.find((c) => c.id === ownerFirst.id)?.index).toBe("UQ_ar_invoice_seller_number")
        expect(ids(invoiceReport.rekey)).toContain(ownerSecond.id)
        expect(ids(invoiceReport.rekey)).not.toEqual(expect.arrayContaining([ownerFirst.id]))
        const paymentReport = reportOf(dry, "ar_invoice_payment")
        expect(ids(paymentReport.keptWithParent)).toContain(clashedPayment.id)
        expect(ids(paymentReport.rekey)).toContain(movedPayment.id)
        expect(ids(reportOf(dry, "seller_seller_product_product").rekey)).toContain(importedLink.id)
        const fundReport = reportOf(dry, "fund")
        expect(ids(fundReport.conflicts)).toEqual(expect.arrayContaining([ownerFund.id, leaverFund.id]))
        expect(ids(fundReport.rekey)).toContain(otherFund.id)
        const entryReport = reportOf(dry, "fund_transaction")
        expect(ids(entryReport.keptWithParent)).toContain(leaverEntry.id)
        expect(ids(entryReport.rekey)).toContain(otherEntry.id)
        const heldPool = dry.held.find((h) => h.table === "demand_post")
        expect(heldPool?.found).toBeGreaterThanOrEqual(1)
        expect(lines.some((l) => l.startsWith("vendor_customer_tier.seller_id") && l.includes("would rekey"))).toBe(true)
        expect(lines.some((l) => l.includes(`left alone (no such member) ${ghostTier.id}`))).toBe(true)
        expect(lines.some((l) => l.startsWith("HELD demand_post.selected_supplier_id"))).toBe(true)

        const applied = await rekeyMemberKeyedStoreData(container(), { apply: true, log: (l) => lines.push(l) })
        expect(applied.targets.filter((t) => t.status === "failed")).toEqual([])
        expect(reportOf(applied, "vendor_customer_tier").rekey.find((r) => r.id === activeTier.id)).toEqual({
          id: activeTier.id,
          member_id: active,
          store_id: s.store.id,
        })
        const after = await snapshot()
        const S = s.store.id
        expect(after).toEqual({
          tiers: [[activeTier.id, S], [ghostTier.id, ghost]].sort(),
          fee: S,
          cycle: S,
          // INV-00001 twice is left for a person: renumbering an invoice a
          // buyer holds is not this script's call.
          invoices: [[ownerFirst.id, owner], [activeFirst.id, active], [ownerSecond.id, S]].sort(),
          payments: [[clashedPayment.id, owner], [movedPayment.id, S]].sort(),
          link: S,
          funds: [[ownerFund.id, owner], [leaverFund.id, leaver.memberId], [otherFund.id, S]].sort(),
          entries: [[leaverEntry.id, leaver.memberId], [otherEntry.id, S]].sort(),
          // Held for an operator and counsel: never rewritten.
          pool: active,
        })
        expect(lines.some((l) => l.includes(`changed ${activeTier.id} ${active} -> ${S}`))).toBe(true)

        // The routes now show the store's other member what the script moved.
        const tiersSeen = await api.get("/vendor/customer-tiers", bearer(s.member.token))
        expect(tiersSeen.data.tiers.map((t: { id: string }) => t.id)).toContain(activeTier.id)
        const fundsSeen = await api.get("/vendor/funds", bearer(s.member.token))
        expect(fundsSeen.data.funds.map((f: { id: string }) => f.id)).toContain(otherFund.id)
        const cyclesSeen = await api.get("/vendor/order-cycles", bearer(s.owner.token))
        expect(cyclesSeen.data.order_cycles.map((c: { id: string }) => c.id)).toContain(leaverCycle.id)

        // A second run finds nothing left to rekey; what it leaves alone is still listed.
        const again = await rekeyMemberKeyedStoreData(container(), { apply: true })
        expect(again.targets.filter((t) => t.rekey.length > 0).map((t) => `${t.table}.${t.column}`)).toEqual([])
        expect(ids(reportOf(again, "vendor_customer_tier").unmatched)).toContain(ghostTier.id)
        expect(ids(reportOf(again, "ar_invoice").conflicts)).toEqual(expect.arrayContaining([ownerFirst.id, activeFirst.id]))
        expect(await snapshot()).toEqual(after)
      })
    })
  },
})
