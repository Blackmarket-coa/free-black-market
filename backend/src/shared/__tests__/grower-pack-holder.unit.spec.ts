import { requirePlanFeature } from "../../api/middlewares/require-plan-feature"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import {
  EntitlementKind,
  EntitlementSource,
  EntitlementStatus,
} from "../../modules/entitlement/models/entitlement"
import EntitlementModuleService from "../../modules/entitlement/service"
import { TENANCY_MODULE } from "../../modules/tenancy"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import type { VendorFeatureKey } from "../../modules/vendor-plan/catalog"
import VendorPlanService from "../../modules/vendor-plan/service"
import { clearPlanFeatureCache } from "../plan-entitlement-cache"
import { loadSellerPlanSnapshot } from "../seller-plan"
import { getAddonOwnership, grantAddon } from "../vendor-addons"

/**
 * What a seller who bought the Grower Tools pack before PL-1 holds after it.
 *
 * Until PL-1 the pack granted `vendor.nursery` and `vendor.production_ledger`;
 * now it grants `vendor.nursery` only, and every plan carries the ledger key.
 * A pack already bought is two entitlement rows in the database, one per key,
 * written at purchase. Nothing re-reads the pack's key list for them: the
 * snapshot the gate uses takes each active, unexpired row's own `feature_key`
 * and adds it to the plan's keys. So the change takes nothing from a holder
 * while the pack is open, and when it lapses the ledger stays through the
 * plan and only nursery goes.
 *
 * The real plan service, the real entitlement service and the real gate, on
 * in-memory CRUD (the `Object.create(Service.prototype)` pattern the two
 * services' own unit specs use). Only the rows are made up, in the shape
 * `grantAddon` wrote them.
 */

const SELLER = "sel_grower"
const DAY = 86_400_000
const NOW = new Date("2026-11-21T12:00:00.000Z")
/** Bought twenty days before PL-1 landed: ten days of its window are left. */
const PACK_ENDS = new Date(NOW.getTime() + 10 * DAY)

type AnyRow = Record<string, unknown> & { id: string }

const matches = (row: AnyRow, filters: Record<string, unknown>) =>
  Object.entries(filters).every(([k, v]) => v === undefined || row[k] === v)

function makeWorld(planCode: string) {
  const assignments: AnyRow[] = [
    { id: "vpa_1", seller_id: SELLER, plan_code: planCode, status: "active" },
  ]
  const events: AnyRow[] = []
  const rows: AnyRow[] = []

  const plans = Object.create(VendorPlanService.prototype) as Record<string, unknown>
  plans.listVendorPlanAssignments = async (f: Record<string, unknown> = {}) =>
    assignments.filter((r) => matches(r, f))
  plans.createVendorPlanEvents = async (entries: Record<string, unknown>[]) => {
    const out = entries.map((e, i) => ({ id: `vpe_${events.length + i + 1}`, ...e }))
    events.push(...out)
    return out
  }

  const entitlements = Object.create(EntitlementModuleService.prototype) as Record<
    string,
    unknown
  >
  entitlements.listEntitlements = async (f: Record<string, unknown> = {}) =>
    rows.filter((r) => matches(r, f))
  entitlements.createEntitlements = async (entries: Record<string, unknown>[]) => {
    const out = entries.map((e, i) => ({ id: `ent_${rows.length + i + 1}`, ...e }))
    rows.push(...out)
    return out
  }
  entitlements.updateEntitlements = async (updates: AnyRow[]) =>
    updates.map((u) => Object.assign(rows.find((r) => r.id === u.id) ?? {}, u))

  const container = {
    resolve: (key: string) => {
      if (key === VENDOR_PLAN_MODULE) return plans
      if (key === ENTITLEMENT_MODULE) return entitlements
      // No organization: the tenancy floor grants nothing.
      if (key === TENANCY_MODULE) return { resolveSellerTier: async () => "tier0_public" }
      throw new Error(`unexpected resolve: ${key}`)
    },
  }

  return {
    container: container as never,
    entitlements: entitlements as unknown as EntitlementModuleService,
    rows,
  }
}

/** The two rows `grantAddon` wrote for `grower_pack` while it carried two keys. */
async function seedPackBoughtBeforePl1(entitlements: EntitlementModuleService) {
  for (const feature_key of ["vendor.nursery", "vendor.production_ledger"]) {
    await entitlements.grant({
      seller_id: SELLER,
      feature_key,
      kind: EntitlementKind.ACCESS_PASS,
      source: EntitlementSource.MANUAL,
      expires_at: PACK_ENDS,
      metadata: { addon: "grower_pack", reason: null },
    })
  }
}

/** Run the real plan gate for one key; the status it answered, or "next". */
async function gate(container: never, key: VendorFeatureKey) {
  clearPlanFeatureCache()
  const res = {
    statusCode: 0,
    body: null as Record<string, unknown> | null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: Record<string, unknown>) {
      this.body = body
      return this
    },
  }
  let passed = false
  await requirePlanFeature(key)(
    { method: "GET", seller: { id: SELLER }, scope: container } as never,
    res as never,
    (() => {
      passed = true
    }) as never
  )
  return passed ? "next" : res.statusCode
}

const heldKeys = async (container: never) =>
  [...(await loadSellerPlanSnapshot(container, SELLER)).feature_keys].sort()

let clock: jest.SpyInstance

beforeEach(() => {
  clearPlanFeatureCache()
  clock = jest.spyOn(Date, "now").mockReturnValue(NOW.getTime())
})

afterEach(() => {
  clock.mockRestore()
  clearPlanFeatureCache()
})

describe.each(["free", "starter"])(
  "a %s seller holding a Grower Tools pack bought before PL-1",
  (planCode) => {
    const soldByPlan = planCode === "starter" ? ["vendor.document_vault", "vendor.embed"] : []

    it("holds nursery and the production ledger while the pack is open", async () => {
      const { container, entitlements } = makeWorld(planCode)
      await seedPackBoughtBeforePl1(entitlements)

      expect(await heldKeys(container)).toEqual(
        [...soldByPlan, "vendor.nursery", "vendor.production_ledger"].sort()
      )
      expect(await gate(container, "vendor.production_ledger")).toBe("next")
      expect(await gate(container, "vendor.nursery")).toBe("next")
    })

    it("keeps the production ledger through the plan once the pack lapses, and loses only nursery", async () => {
      const { container, entitlements } = makeWorld(planCode)
      await seedPackBoughtBeforePl1(entitlements)

      clock.mockReturnValue(PACK_ENDS.getTime() + DAY)

      // The pack's rows grant nothing any more...
      expect(await entitlements.listActiveFeatureKeysForSeller(SELLER)).toEqual([])
      // ...and the ledger key is still held, so it comes from the plan.
      expect(await heldKeys(container)).toEqual(
        [...soldByPlan, "vendor.production_ledger"].sort()
      )
      expect(await gate(container, "vendor.production_ledger")).toBe("next")
      expect(await gate(container, "vendor.nursery")).toBe(402)
    })

    it("reads the pack as owned to its expiry, and a renewal extends it with a nursery row only", async () => {
      const { container, entitlements, rows } = makeWorld(planCode)
      await seedPackBoughtBeforePl1(entitlements)

      const before = await getAddonOwnership(container, SELLER, NOW)
      expect(before.find((o) => o.code === "grower_pack")).toEqual({
        code: "grower_pack",
        active: true,
        expires_at: PACK_ENDS,
      })

      const renewed = await grantAddon(container, {
        sellerId: SELLER,
        code: "grower_pack",
        now: NOW,
      })
      // Thirty days from the END of the open window, not from the renewal.
      expect(renewed.expires_at).toEqual(new Date(PACK_ENDS.getTime() + 30 * DAY))

      const written = rows.slice(2)
      expect(written.map((r) => r.feature_key)).toEqual(["vendor.nursery"])
      expect(written[0].expires_at).toEqual(renewed.expires_at)
      expect(written[0].status).toBe(EntitlementStatus.ACTIVE)

      // Past the first window: nursery is held through the renewal's row, the
      // ledger through the plan.
      clock.mockReturnValue(PACK_ENDS.getTime() + DAY)
      expect(await entitlements.listActiveFeatureKeysForSeller(SELLER)).toEqual([
        "vendor.nursery",
      ])
      expect(await gate(container, "vendor.nursery")).toBe("next")
      expect(await gate(container, "vendor.production_ledger")).toBe("next")
    })
  }
)

describe("a free seller with no pack", () => {
  it("passes the production-ledger gate and meets the paywall on nursery", async () => {
    const { container } = makeWorld("free")

    expect(await heldKeys(container)).toEqual(["vendor.production_ledger"])
    expect(await gate(container, "vendor.production_ledger")).toBe("next")
    expect(await gate(container, "vendor.nursery")).toBe(402)
  })
})
