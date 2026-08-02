import {
  applyPeriodRollover,
  classifyPlanChange,
  decidePlanTransition,
  effectivePlanCode,
  isPendingChangeDue,
  reconcileFeatureKeys,
  type AssignmentSnapshot,
} from "../transitions"
import { VendorPlanStatus } from "../models/vendor-plan-assignment"
import { featureKeysForPlan } from "../catalog"

const NOW = new Date("2026-08-02T12:00:00Z")
const NEXT_MONTH = new Date("2026-09-02T12:00:00Z")

const snapshot = (over: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot => ({
  plan_code: "free",
  status: VendorPlanStatus.ACTIVE,
  current_period_end: null,
  cancel_at_period_end: false,
  pending_plan_code: null,
  pending_effective_at: null,
  ...over,
})

describe("classifyPlanChange", () => {
  it("ranks by price", () => {
    expect(classifyPlanChange("free", "pro")).toBe("upgrade")
    expect(classifyPlanChange("pro", "free")).toBe("downgrade")
    expect(classifyPlanChange("pro", "pro")).toBe("noop")
  })

  it("treats equally priced plans as lateral", () => {
    // free and internal are both 0.
    expect(classifyPlanChange("free", "internal")).toBe("lateral")
  })
})

describe("decidePlanTransition", () => {
  it("rejects an unknown plan", () => {
    const d = decidePlanTransition({
      current: snapshot(),
      to_plan_code: "enterprise-deluxe",
      now: NOW,
    })
    expect(d.kind).toBe("rejected")
  })

  it("rejects a move to the plan already held", () => {
    const d = decidePlanTransition({
      current: snapshot({ plan_code: "pro" }),
      to_plan_code: "pro",
      now: NOW,
    })
    expect(d.kind).toBe("rejected")
  })

  it("applies an upgrade immediately", () => {
    const d = decidePlanTransition({
      current: snapshot({ plan_code: "free" }),
      to_plan_code: "pro",
      now: NOW,
    })
    expect(d.kind).toBe("immediate")
    expect(d.kind === "immediate" && d.change).toBe("upgrade")
  })

  it("defers a downgrade to the end of the paid period", () => {
    // Revoking mid-period would withdraw features already paid for.
    const d = decidePlanTransition({
      current: snapshot({ plan_code: "pro", current_period_end: NEXT_MONTH }),
      to_plan_code: "free",
      now: NOW,
    })
    expect(d.kind).toBe("deferred")
    expect(d.kind === "deferred" && d.effective_at).toEqual(NEXT_MONTH)
  })

  it("applies a downgrade immediately when no paid period remains", () => {
    const d = decidePlanTransition({
      current: snapshot({ plan_code: "pro", current_period_end: null }),
      to_plan_code: "free",
      now: NOW,
    })
    expect(d.kind).toBe("immediate")
  })

  it("applies a downgrade immediately when the period has already lapsed", () => {
    const d = decidePlanTransition({
      current: snapshot({
        plan_code: "pro",
        current_period_end: new Date("2026-07-01T00:00:00Z"),
      }),
      to_plan_code: "free",
      now: NOW,
    })
    expect(d.kind).toBe("immediate")
  })

  it("honours an operator override to downgrade now", () => {
    const d = decidePlanTransition({
      current: snapshot({ plan_code: "pro", current_period_end: NEXT_MONTH }),
      to_plan_code: "free",
      immediate: true,
      now: NOW,
    })
    expect(d.kind).toBe("immediate")
  })
})

describe("reconcileFeatureKeys", () => {
  it("computes a delta rather than a full cycle", () => {
    // Blanket revoke-then-grant would briefly withdraw retained features, which
    // a concurrent request could observe as a denial.
    const current = featureKeysForPlan("pro")
    const r = reconcileFeatureKeys({ plan_code: "pro", current_keys: current })
    expect(r.to_grant).toEqual([])
    expect(r.to_revoke).toEqual([])
  })

  it("grants only what is missing on upgrade", () => {
    const r = reconcileFeatureKeys({
      plan_code: "pro",
      current_keys: featureKeysForPlan("starter"),
    })
    expect(r.to_revoke).toEqual([])
    expect(r.to_grant).not.toContain("vendor.embed") // already held
    expect(r.to_grant).toContain("vendor.pos")
  })

  it("revokes only what the new plan drops on downgrade", () => {
    const r = reconcileFeatureKeys({
      plan_code: "starter",
      current_keys: featureKeysForPlan("pro"),
    })
    expect(r.to_grant).toEqual([])
    expect(r.to_revoke).toContain("vendor.pos")
    // Retained across the change — must not be revoked and re-granted.
    expect(r.to_revoke).not.toContain("vendor.embed")
  })

  it("revokes everything when dropping to free", () => {
    const r = reconcileFeatureKeys({
      plan_code: "free",
      current_keys: featureKeysForPlan("scale"),
    })
    expect(r.desired).toEqual([])
    expect(r.to_grant).toEqual([])
    expect(r.to_revoke.length).toBeGreaterThan(0)
  })
})

describe("applyPeriodRollover", () => {
  it("returns null for a non-recurring plan", () => {
    expect(
      applyPeriodRollover({ plan_code: "free", current_period_end: null, now: NOW })
    ).toBeNull()
  })

  it("rolls forward from the period that just ended", () => {
    // Rolling from `now` instead would silently shorten the next period when
    // the cron runs late.
    const r = applyPeriodRollover({
      plan_code: "pro",
      current_period_end: new Date("2026-08-01T00:00:00Z"),
      now: new Date("2026-08-03T09:00:00Z"),
    })!
    expect(r.current_period_start).toEqual(new Date("2026-08-01T00:00:00Z"))
    expect(r.current_period_end).toEqual(new Date("2026-09-01T00:00:00Z"))
  })

  it("starts from now when no prior period is known", () => {
    const r = applyPeriodRollover({
      plan_code: "pro",
      current_period_end: null,
      now: NOW,
    })!
    expect(r.current_period_start).toEqual(NOW)
    expect(r.current_period_end.getUTCMonth()).toBe(8) // September
  })
})

describe("isPendingChangeDue", () => {
  it("is false without a scheduled change", () => {
    expect(isPendingChangeDue(snapshot(), NOW)).toBe(false)
  })

  it("is false before the effective date", () => {
    expect(
      isPendingChangeDue(
        snapshot({ pending_plan_code: "free", pending_effective_at: NEXT_MONTH }),
        NOW
      )
    ).toBe(false)
  })

  it("is true once the effective date has arrived", () => {
    expect(
      isPendingChangeDue(
        snapshot({ pending_plan_code: "free", pending_effective_at: NOW }),
        NOW
      )
    ).toBe(true)
  })
})

describe("effectivePlanCode", () => {
  it("returns the held plan while active", () => {
    expect(effectivePlanCode(snapshot({ plan_code: "pro" }))).toBe("pro")
  })

  it("retains entitlements while past_due, as a dunning grace period", () => {
    expect(
      effectivePlanCode(
        snapshot({ plan_code: "pro", status: VendorPlanStatus.PAST_DUE })
      )
    ).toBe("pro")
  })

  it("falls back to the default plan once canceled", () => {
    expect(
      effectivePlanCode(
        snapshot({ plan_code: "pro", status: VendorPlanStatus.CANCELED })
      )
    ).toBe("free")
  })
})
