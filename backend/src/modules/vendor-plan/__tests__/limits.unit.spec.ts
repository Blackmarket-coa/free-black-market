import {
  clampToLimit,
  hasRoomFor,
  isUnlimited,
  limitsForPlan,
  plansWithLimits,
  type PlanLimit,
  type VendorPlanLimits,
} from "../limits"
import { VENDOR_PLAN_CATALOG, offeredPlans } from "../catalog"
import {
  asGrowerTierName,
  growerTierIndex,
} from "../../progression/grower-karma"

const LIMIT_KEYS: (keyof VendorPlanLimits)[] = [
  "embed_requests_per_minute",
  "analytics_range_days",
  "embed_keys",
  "connect_domains",
  "webhook_subscriptions",
  "vault_documents",
  "vault_storage_bytes",
]

describe("plan limit table", () => {
  it("covers every plan in the catalog", () => {
    // Drift test. A plan added to the ladder without limits would silently get
    // the free tier's ceilings — a paying vendor capped at one embed key.
    const covered = new Set(plansWithLimits())
    for (const plan of VENDOR_PLAN_CATALOG) {
      expect(covered.has(plan.code)).toBe(true)
    }
  })

  it("defines every limit key on every plan", () => {
    for (const code of plansWithLimits()) {
      const limits = limitsForPlan(code)
      for (const key of LIMIT_KEYS) {
        expect(limits[key]).not.toBeUndefined()
      }
    }
  })

  it("falls back to the free tier for an unknown plan", () => {
    // Fail closed, matching featureKeysForPlan: a typo must not buy a ceiling.
    expect(limitsForPlan("enterprise-deluxe")).toEqual(limitsForPlan("free"))
    expect(limitsForPlan(null)).toEqual(limitsForPlan("free"))
    expect(limitsForPlan(undefined)).toEqual(limitsForPlan("free"))
  })

  it("never lets a higher plan allow less than a lower one", () => {
    // The ladder has to be monotonic or an upgrade could take something away.
    const ladder = ["free", "starter", "pro", "scale"]
    for (let i = 1; i < ladder.length; i++) {
      const lower = limitsForPlan(ladder[i - 1])
      const higher = limitsForPlan(ladder[i])
      for (const key of LIMIT_KEYS) {
        // LIMIT_KEYS holds only the numeric ceilings; the non-numeric floor
        // (grower_tier_floor) has its own monotonicity test below.
        const l = lower[key] as PlanLimit
        const h = higher[key] as PlanLimit
        if (isUnlimited(h)) continue
        expect(isUnlimited(l)).toBe(false)
        expect(h).toBeGreaterThanOrEqual(l as number)
      }
    }
  })

  it("gives the operator plan no countable ceilings", () => {
    const internal = limitsForPlan("internal")
    expect(internal.embed_keys).toBeNull()
    expect(internal.connect_domains).toBeNull()
    expect(internal.webhook_subscriptions).toBeNull()
    expect(internal.vault_documents).toBeNull()
    expect(internal.vault_storage_bytes).toBeNull()
  })

  it("gives every paid tier room for real files, not just paperwork", () => {
    // A storage quota below a single ordinary upload would make the cap fire
    // on the vendor's first real document rather than on abuse.
    for (const code of ["free", "starter", "pro", "scale"]) {
      const bytes = limitsForPlan(code).vault_storage_bytes as number
      expect(bytes).toBeGreaterThanOrEqual(100 * 1024 * 1024)
    }
  })

  it("keeps the free tier usable rather than zeroed", () => {
    // Zero would make the free plan a dead end; every free vendor still needs
    // one key and one domain to run a single embedded storefront.
    const free = limitsForPlan("free")
    expect(free.embed_keys).toBeGreaterThan(0)
    expect(free.connect_domains).toBeGreaterThan(0)
    expect(free.analytics_range_days).toBeGreaterThan(0)
  })

  it("only ever names a real grower tier as a plan floor", () => {
    // Drift guard: the floor is stored as a bare string to keep the limit table
    // import-free, so nothing but this test stops a typo'd tier from silently
    // flooring nobody. A null floor is fine — it means "no tier claim".
    for (const code of plansWithLimits()) {
      const floor = limitsForPlan(code).grower_tier_floor
      if (floor === null) continue
      expect(asGrowerTierName(floor)).toBe(floor)
    }
  })

  it("never lowers the grower tier floor as the ladder rises", () => {
    // Buying a higher plan may skip a grower further up the ladder, never back
    // down it. A null floor (no claim) is treated as the bottom of the ladder.
    const ladder = ["free", "starter", "pro", "scale"]
    const floorIndex = (code: string) => {
      const floor = asGrowerTierName(limitsForPlan(code).grower_tier_floor)
      return floor ? growerTierIndex(floor) : -1
    }
    for (let i = 1; i < ladder.length; i++) {
      expect(floorIndex(ladder[i])).toBeGreaterThanOrEqual(
        floorIndex(ladder[i - 1])
      )
    }
  })
})

describe("all_access limits (Black Mask F8, OI-7)", () => {
  it("never lets a higher offered plan allow less than a lower one, in either flag state", () => {
    for (const allAccessOn of [false, true]) {
      const ladder = offeredPlans(allAccessOn).map((p) => p.code)
      for (let i = 1; i < ladder.length; i++) {
        const lower = limitsForPlan(ladder[i - 1])
        const higher = limitsForPlan(ladder[i])
        for (const key of LIMIT_KEYS) {
          const l = lower[key] as PlanLimit
          const h = higher[key] as PlanLimit
          if (isUnlimited(h)) continue
          expect(isUnlimited(l)).toBe(false)
          expect(h).toBeGreaterThanOrEqual(l as number)
        }
      }
    }
  })

  it("has its own row rather than silently falling back to free", () => {
    expect(plansWithLimits()).toContain("all_access")
    expect(limitsForPlan("all_access")).not.toEqual(limitsForPlan("free"))
  })

  it("takes scale's rate, range and cost meters", () => {
    const all = limitsForPlan("all_access")
    const scale = limitsForPlan("scale")
    expect(all.embed_requests_per_minute).toBe(scale.embed_requests_per_minute)
    expect(all.analytics_range_days).toBe(scale.analytics_range_days)
    // The two cost meters stay bounded: unlimited storage is an unbounded
    // bill, and a null allowance would make overage never billable.
    expect(all.vault_storage_bytes).toBe(scale.vault_storage_bytes)
    expect(all.included_embed_requests).toBe(scale.included_embed_requests)
    expect(all.vault_storage_bytes).not.toBeNull()
    expect(all.included_embed_requests).not.toBeNull()
  })

  it("takes internal's unlimited counts for the configuration objects it unlocks", () => {
    const all = limitsForPlan("all_access")
    expect(all.embed_keys).toBeNull()
    expect(all.connect_domains).toBeNull()
    expect(all.webhook_subscriptions).toBeNull()
    expect(all.vault_documents).toBeNull()
  })

  it("makes no grower tier claim (F7; L27 pending)", () => {
    expect(limitsForPlan("all_access").grower_tier_floor).toBeNull()
  })
})

describe("hasRoomFor", () => {
  it("allows up to and including the limit", () => {
    expect(hasRoomFor(0, 1)).toBe(true)
    expect(hasRoomFor(2, 3)).toBe(true)
  })

  it("refuses once the limit is reached", () => {
    expect(hasRoomFor(1, 1)).toBe(false)
    expect(hasRoomFor(5, 3)).toBe(false)
  })

  it("always allows an unlimited plan", () => {
    expect(hasRoomFor(10_000, null)).toBe(true)
  })

  it("checks a whole submitted set when adding nothing", () => {
    // The connect_domains path replaces the list rather than appending, so it
    // asks "does this set fit", not "is there room for one more".
    expect(hasRoomFor(5, 5, 0)).toBe(true)
    expect(hasRoomFor(6, 5, 0)).toBe(false)
  })

  it("honours a multi-item add", () => {
    expect(hasRoomFor(1, 3, 2)).toBe(true)
    expect(hasRoomFor(2, 3, 2)).toBe(false)
  })
})

describe("clampToLimit", () => {
  it("narrows a request beyond the ceiling", () => {
    expect(clampToLimit(365, 30)).toBe(30)
  })

  it("leaves a request within the ceiling alone", () => {
    expect(clampToLimit(7, 30)).toBe(7)
  })

  it("does not clamp an unlimited allowance", () => {
    expect(clampToLimit(365, null)).toBe(365)
  })
})
