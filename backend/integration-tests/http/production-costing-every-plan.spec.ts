import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { PRODUCTION_COSTING_MODULE } from "../../src/modules/production-costing"
import { PRODUCTION_LEDGER_MODULE } from "../../src/modules/production-ledger"
import { VENDOR_PLAN_MODULE } from "../../src/modules/vendor-plan"
import {
  UNIVERSAL_FEATURE_KEYS,
  VENDOR_PLAN_CATALOG,
  getPlanDefinition,
} from "../../src/modules/vendor-plan/catalog"
import seedVendorPlans from "../../src/scripts/seed-vendor-plans"
import { invalidateSellerPlan } from "../../src/shared/plan-entitlement-cache"
import {
  authHeader,
  createAuthenticatedSeller,
  safe,
  type AuthenticatedSeller,
} from "./helpers/seller-auth"
import { newTestPassword } from "./helpers/test-password"

jest.setTimeout(300 * 1000)

/**
 * Production costing is in every plan (PL-1), on the real server and a
 * database built from the migrations.
 *
 * Until PL-1 `/vendor/production-batches*` and `/vendor/production-costs*`
 * needed `vendor.production_ledger`, which only Scale, all_access, internal
 * and the Grower Tools pack carried, so a free seller got 402. The key is now
 * one every plan carries. Both routes keep their feature flag and their plan
 * gate; what changed is the catalog.
 *
 * Every seller here is on the free plan and every actor is a real member id:
 * each store is made by Mercur's createSellerWorkflow and its owner signs in
 * through Medusa's own route (`createAuthenticatedSeller`); the second member
 * is a login linked to its own member row, as an accepted invite leaves one,
 * and signs in the same way (the fixture `vendor-store-keying.spec.ts` uses).
 *
 * The runner truncates the database after each test, so each test makes its
 * own stores.
 */

const LEDGER_FLAG = "FF_PRODUCTION_LEDGER_V1"
const COSTING_FLAG = "FF_PRODUCTION_COSTING_V1"

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    [LEDGER_FLAG]: "true",
    [COSTING_FLAG]: "true",
    // On, so that a free seller meets the paywall (402) on a key that is
    // still sold, and not the kill switch (404).
    FF_NURSERY_VERTICAL_V1: "true",
  },
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

    const freeStore = (name: string) =>
      createAuthenticatedSeller({ api, getContainer, storeName: `${name} ${uid()}`, planCode: "free" })

    /** A second login on the store, linked to its own member row, signed in for real. */
    async function secondMember(storeId: string) {
      const email = `member-${uid()}@example.com`
      const password = newTestPassword("member")
      const auth = container().resolve(Modules.AUTH)
      await auth.register("emailpass", { body: { email, password } } as any)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      const [member] = await container()
        .resolve(SELLER_MODULE)
        .createMembers([{ seller_id: storeId, name: "Second Member", email, role: "member" }])
      await auth.updateAuthIdentities([{ id: provider.auth_identity_id, app_metadata: { seller_id: member.id } }])
      const signedIn = await api.post("/auth/seller/emailpass", { email, password })
      return { memberId: member.id as string, token: signedIn.data.token as string }
    }

    const makeBatch = (who: { token: string }, body: Record<string, unknown> = {}) =>
      safe(api.post("/vendor/production-batches", { item_label: "Sourdough", qty_started: 12, yield_qty: 10, ...body }, authHeader(who.token)))

    const addCost = (who: { token: string }, batchId: string, body: Record<string, unknown>) =>
      safe(api.post("/vendor/production-costs", { production_batch_id: batchId, ...body }, authHeader(who.token)))

    const rollupOf = (who: { token: string }, batchId: string, query = "") =>
      safe(api.get(`/vendor/production-costs/rollup?production_batch_id=${batchId}${query}`, authHeader(who.token)))

    const NUMERIC_FIELDS = ["quantity", "unit_amount_cents", "amount_cents"] as const
    const typesOf = (entry: Record<string, unknown>) =>
      Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, typeof entry[f]]))
    const ALL_NUMBERS = { quantity: "number", unit_amount_cents: "number", amount_cents: "number" }

    describe("a seller on the free plan", () => {
      it("records a batch and its costs and reads the rollup, with numbers for numbers", async () => {
        const seller: AuthenticatedSeller = await freeStore("Free Bakery")
        const h = authHeader(seller.token)

        // The fixture is what the test says it is: the free plan, and a member actor.
        const [assignment] = await container().resolve(VENDOR_PLAN_MODULE).listVendorPlanAssignments({ seller_id: seller.seller.id })
        expect(assignment.plan_code).toBe("free")
        expect(seller.actorId.startsWith("mem_")).toBe(true)
        expect(seller.actorId).not.toBe(seller.seller.id)
        expect(jwt.decode(seller.token)).toMatchObject({ actor_id: seller.actorId, actor_type: "seller" })

        const batch = await makeBatch(seller)
        expect(batch.status).toBe(201)
        const batchId: string = batch.data.production_batch.id

        // A fractional quantity: 2.5 sacks at 12.50.
        const flour = await addCost(seller, batchId, { category: "material", label: "Rye flour, 25kg sack", quantity: 2.5, unit_amount_cents: 1250 })
        expect(flour.status).toBe(201)
        expect(typesOf(flour.data.production_cost_entry)).toEqual(ALL_NUMBERS)
        expect(flour.data.production_cost_entry).toMatchObject({ quantity: 2.5, unit_amount_cents: 1250, amount_cents: 3125, is_cash_outlay: true })

        const labor = await addCost(seller, batchId, { category: "labor", label: "Volunteer bake shift", source: "donated", amount_cents: 1000 })
        expect(labor.status).toBe(201)
        expect(typesOf(labor.data.production_cost_entry)).toEqual(ALL_NUMBERS)
        expect(labor.data.production_cost_entry).toMatchObject({ quantity: 1, unit_amount_cents: 0, amount_cents: 1000, is_cash_outlay: false })

        // Read back from the database, where `quantity` is a NUMERIC column:
        // the whole list, and the list for one batch.
        for (const path of ["/vendor/production-costs", `/vendor/production-costs?production_batch_id=${batchId}`]) {
          const listed = await safe(api.get(path, h))
          expect({ path, status: listed.status, count: listed.data.count }).toEqual({ path, status: 200, count: 2 })
          for (const entry of listed.data.production_cost_entries) {
            expect({ path, ...typesOf(entry) }).toEqual({ path, ...ALL_NUMBERS })
          }
          const read = listed.data.production_cost_entries.find((e: { id: string }) => e.id === flour.data.production_cost_entry.id)
          expect(read).toMatchObject({ quantity: 2.5, unit_amount_cents: 1250, amount_cents: 3125 })
        }

        const rollup = await rollupOf(seller, batchId, "&price_cents=825")
        expect(rollup.status).toBe(200)
        expect(rollup.data.costing).toMatchObject({
          production_batch_id: batchId,
          entry_count: 2,
          total_cents: 4125,
          cash_outlay_cents: 3125,
          in_kind_cents: 1000,
          yield_qty: 10,
          // 4125 / 10 and 3125 / 10, each rounded to a whole cent.
          unit_cost_cents: 413,
          unit_cash_cost_cents: 313,
          currency_code: "usd",
        })
        expect(rollup.data.costing.by_category).toMatchObject({ material: 3125, labor: 1000 })
        expect(rollup.data.costing.margin_percent_at_price).toBeCloseTo(((825 - 413) / 825) * 100, 6)

        // What the panel reads to show the Production Ledger nav item.
        const plan = await safe(api.get("/vendor/plan/me", h))
        expect(plan.status).toBe(200)
        expect(plan.data.plan.code).toBe("free")
        expect(plan.data.feature_keys).toEqual([...UNIVERSAL_FEATURE_KEYS])

        // The paywall still stands for what is sold: same seller, a sold key.
        const nursery = await safe(api.get("/vendor/nursery/products", h))
        expect(nursery.status).toBe(402)
        expect(nursery.data).toMatchObject({ code: "plan_upgrade_required", required_feature: "vendor.nursery", current_plan: "free" })
      })

      it("is let in with no plan assignment at all, and is put on free", async () => {
        // Sellers made before plans existed, or by a path that assigns none,
        // have no row; the gate gives them `free` on first use.
        const seller = await freeStore("Unprovisioned Farm")
        const plans = container().resolve(VENDOR_PLAN_MODULE)
        const [row] = await plans.listVendorPlanAssignments({ seller_id: seller.seller.id })
        await plans.deleteVendorPlanAssignments(row.id)
        invalidateSellerPlan(seller.seller.id)
        expect(await plans.listVendorPlanAssignments({ seller_id: seller.seller.id })).toEqual([])

        const batch = await makeBatch(seller)
        expect(batch.status).toBe(201)
        const cost = await addCost(seller, batch.data.production_batch.id, { category: "packaging", label: "Jars", amount_cents: 500 })
        expect(cost.status).toBe(201)

        const [made] = await plans.listVendorPlanAssignments({ seller_id: seller.seller.id })
        expect(made.plan_code).toBe("free")
      })
    })

    describe("keyed by the store", () => {
      it("a second member of the store sees and adds to the owner's batch and costs; another store gets nothing", async () => {
        const a = await freeStore("Team Bakery")
        const b = await freeStore("Other Bakery")
        const member = await secondMember(a.seller.id)
        // Two different member actors of one store, neither of them the store id.
        expect(jwt.decode(member.token)).toMatchObject({ actor_id: member.memberId })
        expect(member.memberId).not.toBe(a.actorId)
        expect(member.memberId.startsWith("mem_")).toBe(true)

        const batch = await makeBatch(a)
        expect(batch.status).toBe(201)
        const batchId: string = batch.data.production_batch.id
        // Written under the store, not under the member who called.
        expect(batch.data.production_batch.seller_id).toBe(a.seller.id)

        const flour = await addCost(a, batchId, { category: "material", label: "Flour", quantity: 2.5, unit_amount_cents: 1250 })
        expect(flour.status).toBe(201)
        expect(flour.data.production_cost_entry.seller_id).toBe(a.seller.id)
        const flourId: string = flour.data.production_cost_entry.id

        // The store's other member reads all of it...
        const hMember = authHeader(member.token)
        const memberBatches = await safe(api.get("/vendor/production-batches", hMember))
        expect(memberBatches.status).toBe(200)
        expect(memberBatches.data.production_batches.map((x: { id: string }) => x.id)).toEqual([batchId])
        const memberCosts = await safe(api.get("/vendor/production-costs", hMember))
        expect(memberCosts.status).toBe(200)
        expect(memberCosts.data.production_cost_entries.map((x: { id: string }) => x.id)).toEqual([flourId])
        const memberRollup = await rollupOf(member, batchId)
        expect(memberRollup.status).toBe(200)
        expect(memberRollup.data.costing).toMatchObject({ entry_count: 1, total_cents: 3125 })

        // ...and adds a line to the owner's batch, which the owner then sees.
        const jars = await addCost(member, batchId, { category: "packaging", label: "Jars", amount_cents: 600 })
        expect(jars.status).toBe(201)
        expect(jars.data.production_cost_entry.seller_id).toBe(a.seller.id)
        const ownerRollup = await rollupOf(a, batchId)
        expect(ownerRollup.data.costing).toMatchObject({ entry_count: 2, total_cents: 3725 })

        // Nothing is stored under either member id.
        const batchRows = await container().resolve(PRODUCTION_LEDGER_MODULE).listProductionBatches({})
        expect(batchRows.map((r: { seller_id: string }) => r.seller_id)).toEqual([a.seller.id])
        const costRows = await container().resolve(PRODUCTION_COSTING_MODULE).listProductionCostEntries({})
        expect(costRows.map((r: { seller_id: string }) => r.seller_id)).toEqual([a.seller.id, a.seller.id])

        // Another store: empty lists, and 404 for anything of store A's by id.
        const hB = authHeader(b.token)
        const bBatches = await safe(api.get("/vendor/production-batches", hB))
        expect({ status: bBatches.status, count: bBatches.data.count }).toEqual({ status: 200, count: 0 })
        const bCosts = await safe(api.get("/vendor/production-costs", hB))
        expect({ status: bCosts.status, count: bCosts.data.count }).toEqual({ status: 200, count: 0 })
        const bCostsOfBatch = await safe(api.get(`/vendor/production-costs?production_batch_id=${batchId}`, hB))
        expect({ status: bCostsOfBatch.status, count: bCostsOfBatch.data.count }).toEqual({ status: 200, count: 0 })
        expect((await rollupOf(b, batchId)).status).toBe(404)
        expect((await addCost(b, batchId, { category: "material", label: "x", amount_cents: 1 })).status).toBe(404)
        expect((await safe(api.delete(`/vendor/production-costs/${flourId}`, hB))).status).toBe(404)
        expect((await safe(api.delete(`/vendor/production-batches/${batchId}`, hB))).status).toBe(404)
        expect((await rollupOf(a, batchId)).data.costing).toMatchObject({ entry_count: 2, total_cents: 3725 })

        // The second member removes the owner's line.
        const removed = await safe(api.delete(`/vendor/production-costs/${flourId}`, hMember))
        expect(removed.status).toBe(200)
        expect((await rollupOf(a, batchId)).data.costing).toMatchObject({ entry_count: 1, total_cents: 600 })
      })
    })

    describe("with the feature flags unset", () => {
      // The gate reads `process.env` on every request (`shared/feature-flags.ts`)
      // and nothing reads these two flags at boot, so unsetting them in this
      // process is the state of a server started without them.
      const withEnv = async (unset: string[], run: () => Promise<void>) => {
        const kept = unset.map((name) => [name, process.env[name]] as const)
        for (const name of unset) delete process.env[name]
        try {
          await run()
        } finally {
          for (const [name, value] of kept) process.env[name] = value
        }
      }
      const disabled = (flag: string) => ({ status: 404, type: "feature_disabled", message: `Feature flag ${flag} is disabled` })
      const answer = (res: { status: number; data: Record<string, unknown> }) => ({ status: res.status, type: res.data?.type, message: res.data?.message })

      it("every production route answers 404, each family by its own flag, and the data is there when they come back", async () => {
        const seller = await freeStore("Flagged Bakery")
        const h = authHeader(seller.token)
        const batch = await makeBatch(seller)
        const batchId: string = batch.data.production_batch.id
        const cost = await addCost(seller, batchId, { category: "material", label: "Flour", amount_cents: 3000 })
        const costId: string = cost.data.production_cost_entry.id
        expect([batch.status, cost.status]).toEqual([201, 201])

        await withEnv([LEDGER_FLAG, COSTING_FLAG], async () => {
          expect(answer(await safe(api.get("/vendor/production-batches", h)))).toEqual(disabled(LEDGER_FLAG))
          expect(answer(await makeBatch(seller))).toEqual(disabled(LEDGER_FLAG))
          expect(answer(await safe(api.delete(`/vendor/production-batches/${batchId}`, h)))).toEqual(disabled(LEDGER_FLAG))
          expect(answer(await safe(api.get("/vendor/production-costs", h)))).toEqual(disabled(COSTING_FLAG))
          expect(answer(await addCost(seller, batchId, { category: "material", label: "x", amount_cents: 1 }))).toEqual(disabled(COSTING_FLAG))
          expect(answer(await rollupOf(seller, batchId))).toEqual(disabled(COSTING_FLAG))
          expect(answer(await safe(api.delete(`/vendor/production-costs/${costId}`, h)))).toEqual(disabled(COSTING_FLAG))
        })

        // One flag each: the other family still answers.
        await withEnv([LEDGER_FLAG], async () => {
          expect(answer(await safe(api.get("/vendor/production-batches", h)))).toEqual(disabled(LEDGER_FLAG))
          expect((await safe(api.get("/vendor/production-costs", h))).status).toBe(200)
        })
        await withEnv([COSTING_FLAG], async () => {
          expect(answer(await safe(api.get("/vendor/production-costs", h)))).toEqual(disabled(COSTING_FLAG))
          expect((await safe(api.get("/vendor/production-batches", h))).status).toBe(200)
        })

        // Back on: nothing was written or removed while they were off.
        const batches = await safe(api.get("/vendor/production-batches", h))
        expect(batches.data.production_batches.map((x: { id: string }) => x.id)).toEqual([batchId])
        expect((await rollupOf(seller, batchId)).data.costing).toMatchObject({ entry_count: 1, total_cents: 3000 })
      })
    })

    describe("the denormalized vendor_plan rows", () => {
      it("the gate is right while the rows are stale, and seed-vendor-plans brings them to the catalog", async () => {
        const plans = container().resolve(VENDOR_PLAN_MODULE)
        const rowsByCode = async () =>
          new Map<string, any>((await plans.listVendorPlans({})).map((r: { code: string }) => [r.code, r]))

        // The rows as a deployment seeded before PL-1 has them: free with no
        // feature key, starter without the ledger, each with its old copy.
        await plans.createVendorPlans([
          { code: "free", display_name: "Free", description: "Everything needed to list and sell: products, orders, customers and payouts.", price_amount: 0, interval: "none", feature_keys: [] },
          { code: "starter", display_name: "Starter", description: "stale", price_amount: 2900, interval: "month", feature_keys: ["vendor.embed", "vendor.document_vault"] },
        ])

        const seller = await freeStore("Stale Rows Bakery")
        const h = authHeader(seller.token)

        // The gate does not read them.
        const batch = await makeBatch(seller)
        expect(batch.status).toBe(201)
        expect((await rollupOf(seller, batch.data.production_batch.id)).status).toBe(200)
        // Nor does the plan screen: keys and copy come from the catalog.
        const me = await safe(api.get("/vendor/plan/me", h))
        expect(me.data.feature_keys).toEqual([...UNIVERSAL_FEATURE_KEYS])
        const offeredFree = me.data.available_plans.find((p: { code: string }) => p.code === "free")
        expect(offeredFree.feature_keys).toEqual([...UNIVERSAL_FEATURE_KEYS])
        expect(offeredFree.description).toBe(getPlanDefinition("free")!.description)
        // The pack list is code as well.
        const addons = await safe(api.get("/vendor/addons", h))
        const grower = addons.data.addons.find((x: { code: string }) => x.code === "grower_pack")
        expect(grower.feature_keys).toEqual(["vendor.nursery"])

        // Still stale after all of that: nothing rewrites the rows on its own.
        expect((await rowsByCode()).get("free").feature_keys).toEqual([])

        // What the operator runs after deploy.
        await seedVendorPlans({ container: container() } as any)

        const seeded = await rowsByCode()
        expect([...seeded.keys()].sort()).toEqual(VENDOR_PLAN_CATALOG.map((p) => p.code).sort())
        for (const plan of VENDOR_PLAN_CATALOG) {
          const row = seeded.get(plan.code)
          expect({ code: plan.code, feature_keys: row.feature_keys, description: row.description }).toEqual({
            code: plan.code,
            feature_keys: plan.feature_keys,
            description: plan.description,
          })
          for (const key of UNIVERSAL_FEATURE_KEYS) {
            expect(row.feature_keys).toContain(key)
          }
        }
      })
    })
  },
})
