import { GET as LIST } from "../route"
import { POST as PURCHASE } from "../purchase/route"
import { POST as CHANGE } from "../../plan/change/route"
import { processPlanRenewals } from "../../../../jobs/vendor-plan-renewals"
import VendorPlanService from "../../../../modules/vendor-plan/service"
import VendorBillingService from "../../../../modules/vendor-billing/service"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import { VENDOR_BILLING_MODULE } from "../../../../modules/vendor-billing"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import { EntitlementStatus } from "../../../../modules/entitlement/models/entitlement"
import { VENDOR_ADDON_CATALOG } from "../../../../modules/vendor-plan/addons"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import { clearPlanFeatureCache } from "../../../../shared/plan-entitlement-cache"

/**
 * Operator answer OI-9 (2026-10-05): add-ons are KEPT by the buyer. Whatever
 * plan a vendor moves to, a pack they bought is never revoked, deactivated or
 * refunded. Under FF_ALL_ACCESS_PLAN_V1, an all_access vendor is not OFFERED
 * packs their plan already covers (they would pay for nothing), but a pack
 * they own stays active and listed as owned.
 *
 * Real route handlers, a real `VendorPlanService` over in-memory rows, the
 * real renewal job; the entitlement module is an in-memory table whose every
 * write is spied on, so "never revoked" is asserted on the writes themselves.
 */

jest.mock("../../../../shared", () => ({
  requireSellerId: jest.fn(async () => "sel_1"),
}))

const ENV = PHASE0_FEATURE_FLAGS.ALL_ACCESS_PLAN_V1
const SELLER = "sel_1"
const DAY = 86_400_000

type Row = Record<string, unknown> & { id: string }

const matches = (row: Row, filters: Record<string, unknown>) =>
  Object.entries(filters).every(([k, v]) => {
    if (v === undefined) return true
    if (v && typeof v === "object" && "$lte" in v) {
      const bound = (v as { $lte: Date }).$lte
      return row[k] != null && new Date(row[k] as Date).getTime() <= new Date(bound).getTime()
    }
    return row[k] === v
  })

function makeWorld(opts: { ownedPack?: string; expiresAt?: Date } = {}) {
  // Plans: the real service.
  const assignments: Row[] = []
  const events: Row[] = []
  const plans = Object.create(VendorPlanService.prototype) as Record<string, unknown>
  plans.listVendorPlanAssignments = async (f: Record<string, unknown> = {}) =>
    assignments.filter((r) => matches(r, f))
  plans.createVendorPlanAssignments = async (e: Row | Row[]) => {
    const out = (Array.isArray(e) ? e : [e]).map((x, i) => ({ ...x, id: `vpa_${assignments.length + i + 1}` }))
    assignments.push(...out)
    return out
  }
  plans.updateVendorPlanAssignments = async (u: Row | Row[]) =>
    (Array.isArray(u) ? u : [u]).map((x) => {
      const r = assignments.find((a) => a.id === x.id)
      if (r) Object.assign(r, x)
      return r
    })
  plans.listVendorPlanEvents = async (f: Record<string, unknown> = {}) =>
    events.filter((r) => matches(r, f))
  plans.createVendorPlanEvents = async (e: Row | Row[]) => {
    const out = (Array.isArray(e) ? e : [e]).map((x, i) => ({ ...x, id: `vpe_${events.length + i + 1}` }))
    events.push(...out)
    return out
  }

  // Billing: the real service.
  const charges: Row[] = []
  const billing = Object.create(VendorBillingService.prototype) as Record<string, unknown>
  billing.listVendorCharges = async (where: Record<string, unknown> = {}) =>
    charges.filter((c) => Object.entries(where).every(([k, v]) => c[k] === v))
  billing.createVendorCharges = async (data: Row) => {
    const row = { ...data, id: `vc_${charges.length + 1}` }
    charges.push(row)
    return row
  }
  billing.updateVendorCharges = async (data: Row) => {
    const row = charges.find((c) => c.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }

  // Entitlements: an owned pack is one ACTIVE row per key with metadata.addon.
  const expires = opts.expiresAt ?? new Date(Date.now() + 20 * DAY)
  const rows: Row[] = []
  if (opts.ownedPack) {
    const pack = VENDOR_ADDON_CATALOG.find((a) => a.code === opts.ownedPack)!
    pack.feature_keys.forEach((feature_key, i) =>
      rows.push({
        id: `ent_${i + 1}`,
        seller_id: SELLER,
        feature_key,
        status: EntitlementStatus.ACTIVE,
        expires_at: expires,
        metadata: { addon: pack.code },
      })
    )
  }
  const entitlementWrites = {
    updateEntitlements: jest.fn(async () => []),
    grant: jest.fn(async () => ({})),
    revoke: jest.fn(async () => ({})),
    deleteEntitlements: jest.fn(async () => ({})),
  }
  const entitlements = {
    listEntitlements: jest.fn(async (f: Record<string, unknown> = {}) =>
      rows.filter((r) => matches(r, f))
    ),
    listActiveFeatureKeysForSeller: jest.fn(async () =>
      rows.filter((r) => r.status === EntitlementStatus.ACTIVE).map((r) => r.feature_key as string)
    ),
    ...entitlementWrites,
  }

  const resolve = jest.fn((key: string) => {
    if (key === VENDOR_PLAN_MODULE) return plans
    if (key === VENDOR_BILLING_MODULE) return billing
    if (key === ENTITLEMENT_MODULE) return entitlements
    throw new Error(`unexpected container key: ${key}`)
  })
  const scope = { resolve }

  const call = async (
    handler: (req: never, res: never) => Promise<unknown>,
    body: Record<string, unknown> = {}
  ) => {
    const res = {
      statusCode: 200,
      body: undefined as unknown as Record<string, unknown>,
      status(code: number) {
        res.statusCode = code
        return res
      },
      json(payload: unknown) {
        res.body = payload as Record<string, unknown>
        return res
      },
    }
    await handler({ body, params: {}, scope } as never, res as never)
    return res
  }

  return { call, scope, resolve, assignments, charges, rows, entitlementWrites }
}

type ListedAddon = {
  code: string
  owned: { code: string; active: boolean }
  covered_by_plan?: boolean
}
const codes = (body: Record<string, unknown>) =>
  (body.addons as ListedAddon[]).map((a) => a.code)

const ALL_PACKS_IN_ORDER = [...VENDOR_ADDON_CATALOG]
  .filter((a) => a.is_active)
  .sort((a, b) => a.display_order - b.display_order)
  .map((a) => a.code)

const BILLING_ENV = ["STRIPE_SECRET_KEY", "VENDOR_BILLING_ENABLED"] as const
let savedBilling: Record<string, string | undefined>

beforeEach(() => {
  clearPlanFeatureCache()
  savedBilling = Object.fromEntries(BILLING_ENV.map((k) => [k, process.env[k]]))
  for (const k of BILLING_ENV) delete process.env[k]
})

afterEach(() => {
  delete process.env[ENV]
  for (const k of BILLING_ENV) {
    if (savedBilling[k] === undefined) delete process.env[k]
    else process.env[k] = savedBilling[k]
  }
})

describe("add-ons across plan changes (flag on)", () => {
  beforeEach(() => {
    process.env[ENV] = "true"
  })

  it("never touches an owned pack when the vendor moves to all_access and back", async () => {
    const world = makeWorld({ ownedPack: "grower_pack" })

    const up = await world.call(CHANGE, { plan_code: "all_access", auto_renew_consent: true })
    expect(up.statusCode).toBe(200)

    // Listed as owned and covered; everything else (covered, not owned) hidden.
    const onAll = await world.call(LIST)
    expect(onAll.statusCode).toBe(200)
    expect(codes(onAll.body)).toEqual(["grower_pack"])
    const grower = (onAll.body.addons as ListedAddon[])[0]
    expect(grower.owned.active).toBe(true)
    expect(grower.covered_by_plan).toBe(true)

    // Back to free: cancel, then let the trial run out and the job apply it.
    await world.call(CHANGE, { plan_code: "free" })
    const trialEnd = new Date(world.assignments[0].current_period_end as Date)
    await processPlanRenewals(world.scope as never, new Date(trialEnd.getTime() + 3_600_000))
    expect(world.assignments[0].plan_code).toBe("free")
    clearPlanFeatureCache()

    const onFree = await world.call(LIST)
    expect(codes(onFree.body)).toEqual(ALL_PACKS_IN_ORDER)
    const growerAgain = (onFree.body.addons as ListedAddon[]).find((a) => a.code === "grower_pack")!
    expect(growerAgain.owned.active).toBe(true)
    expect(growerAgain.covered_by_plan).toBe(false)

    // No entitlement write happened anywhere along the way, and the rows
    // are exactly as bought.
    for (const spy of Object.values(world.entitlementWrites)) {
      expect(spy).not.toHaveBeenCalled()
    }
    expect(world.rows.every((r) => r.status === EntitlementStatus.ACTIVE)).toBe(true)
    // ...and the plan module really was read (not a fallback that lists all).
    expect(world.resolve).toHaveBeenCalledWith(VENDOR_PLAN_MODULE)
  })

  it("offers an all_access vendor no packs, and a free vendor every pack", async () => {
    const world = makeWorld()
    expect(codes((await world.call(LIST)).body)).toEqual(ALL_PACKS_IN_ORDER)

    await world.call(CHANGE, { plan_code: "all_access", auto_renew_consent: true })
    clearPlanFeatureCache()
    expect(codes((await world.call(LIST)).body)).toEqual([])
  })

  it("refuses to sell an all_access vendor a pack their plan covers, recording nothing", async () => {
    const world = makeWorld()
    await world.call(CHANGE, { plan_code: "all_access", auto_renew_consent: true })

    const res = await world.call(PURCHASE, { code: "quest_pack" })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "conflict", code: "included_in_plan" })
    expect(world.charges).toHaveLength(0)
  })

  it("offers and sells packs again once the all_access vendor has scheduled a move off it", async () => {
    // Trialing all_access, then cancel (deferred to the trial's end): they
    // may buy a pack now to keep after the plan ends.
    const world = makeWorld()
    await world.call(CHANGE, { plan_code: "all_access", auto_renew_consent: true })
    const cancel = await world.call(CHANGE, { plan_code: "free" })
    expect(cancel.body.deferred).toBe(true)
    expect(world.assignments[0].plan_code).toBe("all_access")
    clearPlanFeatureCache()

    expect(codes((await world.call(LIST)).body)).toEqual(ALL_PACKS_IN_ORDER)
    const res = await world.call(PURCHASE, { code: "quest_pack" })
    // Past the coverage check, to the pre-flag billing check.
    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe("billing_unavailable")
  })

  it("does not hide packs from a vendor on a retired tier (scoped to all_access)", async () => {
    // starter covers embed_pack's keys, but OI-9 hides packs for all_access only.
    const world = makeWorld()
    world.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "starter",
      status: "active",
    })
    expect(codes((await world.call(LIST)).body)).toEqual(ALL_PACKS_IN_ORDER)
    const res = await world.call(PURCHASE, { code: "embed_pack" })
    expect(res.statusCode).toBe(503)
    expect(world.resolve).toHaveBeenCalledWith(VENDOR_PLAN_MODULE)
  })

  it("still sells a free vendor a pack (reaches the pre-flag billing check)", async () => {
    const world = makeWorld()
    const res = await world.call(PURCHASE, { code: "quest_pack" })
    // Billing unconfigured here, so the pre-flag 503 — proof the coverage
    // check let it through rather than refusing it.
    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe("billing_unavailable")
  })
})

describe("add-ons with FF_ALL_ACCESS_PLAN_V1 off", () => {
  it("lists every pack in the pre-flag shape and never reads the plan", async () => {
    const world = makeWorld({ ownedPack: "grower_pack" })
    const res = await world.call(LIST)

    expect(codes(res.body)).toEqual(ALL_PACKS_IN_ORDER)
    for (const addon of res.body.addons as Record<string, unknown>[]) {
      expect(Object.keys(addon).sort()).toEqual(
        [
          "code",
          "currency_code",
          "description",
          "display_name",
          "duration_days",
          "feature_keys",
          "owned",
          "price_amount",
        ].sort()
      )
    }
    expect(res.body.purchasable).toBe(false)
    expect(world.resolve).not.toHaveBeenCalledWith(VENDOR_PLAN_MODULE)
  })

  it("does not apply the coverage refusal to purchases", async () => {
    // Even an all_access assignment (operator-assigned) buys as before.
    const world = makeWorld()
    world.assignments.push({
      id: "vpa_1",
      seller_id: SELLER,
      plan_code: "all_access",
      status: "active",
    })
    const res = await world.call(PURCHASE, { code: "quest_pack" })
    expect(res.statusCode).toBe(503)
    expect(world.resolve).not.toHaveBeenCalledWith(VENDOR_PLAN_MODULE)
  })
})
