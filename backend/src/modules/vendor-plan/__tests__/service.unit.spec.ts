import VendorPlanService from "../service"
import { VendorPlanStatus, VendorPlanAssignedBy } from "../models"
import { featureKeysForPlan } from "../catalog"

/**
 * Exercises VendorPlanService against an in-memory CRUD fake, following the
 * `entitlement-service.unit.spec.ts` harness: the real class is instantiated
 * via `Object.create` so the public methods reach through the prototype, and
 * the auto-generated CRUD ops are patched onto the instance.
 *
 * The fake enforces the unique index on `vendor_plan_event.idempotency_key`,
 * because that constraint is the actual mechanism under test — without it the
 * replay assertions would pass vacuously.
 */
function makeService(): VendorPlanService {
  const assignments: any[] = []
  const events: any[] = []
  const plans: any[] = []

  const svc = Object.create(VendorPlanService.prototype) as VendorPlanService

  const matches = (row: any, filters: Record<string, any>) =>
    Object.entries(filters).every(([k, v]) => {
      if (v === undefined) return true
      if (v && typeof v === "object" && "$lte" in v) {
        return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).$lte).getTime()
      }
      if (Array.isArray(v)) return v.includes(row[k])
      return row[k] === v
    })

  ;(svc as any).listVendorPlans = async (f: Record<string, any> = {}) =>
    plans.filter((r) => matches(r, f))
  ;(svc as any).createVendorPlans = async (e: any) => {
    const entries = Array.isArray(e) ? e : [e]
    const out = entries.map((x, i) => ({ id: `vp_${plans.length + i + 1}`, ...x }))
    plans.push(...out)
    return out
  }
  ;(svc as any).updateVendorPlans = async (u: any) => {
    const ups = Array.isArray(u) ? u : [u]
    return ups.map((x) => {
      const r = plans.find((p) => p.id === x.id)
      if (r) Object.assign(r, x)
      return r
    })
  }

  ;(svc as any).listVendorPlanAssignments = async (f: Record<string, any> = {}) =>
    assignments.filter((r) => matches(r, f))
  ;(svc as any).createVendorPlanAssignments = async (e: any) => {
    const entries = Array.isArray(e) ? e : [e]
    const out = entries.map((x, i) => ({
      id: `vpa_${assignments.length + i + 1}`,
      ...x,
    }))
    assignments.push(...out)
    return out
  }
  ;(svc as any).updateVendorPlanAssignments = async (u: any) => {
    const ups = Array.isArray(u) ? u : [u]
    return ups.map((x) => {
      const r = assignments.find((a) => a.id === x.id)
      if (r) Object.assign(r, x)
      return r
    })
  }

  ;(svc as any).listVendorPlanEvents = async (f: Record<string, any> = {}) =>
    events.filter((r) => matches(r, f))
  ;(svc as any).createVendorPlanEvents = async (e: any) => {
    const entries = Array.isArray(e) ? e : [e]
    for (const x of entries) {
      // Enforce the partial unique index the migration creates.
      if (
        x.idempotency_key &&
        events.some((ev) => ev.idempotency_key === x.idempotency_key)
      ) {
        const err: any = new Error("duplicate key value violates unique constraint")
        err.code = "23505"
        throw err
      }
    }
    const out = entries.map((x, i) => ({ id: `vpe_${events.length + i + 1}`, ...x }))
    events.push(...out)
    return out
  }

  ;(svc as any).__state = { assignments, events, plans }
  return svc
}

const SELLER = "sel_1"

describe("ensureAssignment", () => {
  it("auto-provisions a seller onto the default plan", async () => {
    // "On free" and "never provisioned" must never be distinguishable.
    const svc = makeService()
    const a = await svc.ensureAssignment(SELLER)
    expect(a.plan_code).toBe("free")
    expect(a.status).toBe(VendorPlanStatus.ACTIVE)
  })

  it("is stable across calls", async () => {
    const svc = makeService()
    const first = await svc.ensureAssignment(SELLER)
    const second = await svc.ensureAssignment(SELLER)
    expect(second.id).toBe(first.id)
    expect((svc as any).__state.assignments).toHaveLength(1)
  })

  it("records an assignment event", async () => {
    const svc = makeService()
    await svc.ensureAssignment(SELLER)
    expect((svc as any).__state.events).toHaveLength(1)
    expect((svc as any).__state.events[0].type).toBe("assigned")
  })
})

describe("getEntitledFeatureKeys", () => {
  it("returns nothing for a free seller", async () => {
    const svc = makeService()
    expect(await svc.getEntitledFeatureKeys(SELLER)).toEqual([])
  })

  it("returns the plan's keys after an upgrade", async () => {
    const svc = makeService()
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" })
    expect(new Set(await svc.getEntitledFeatureKeys(SELLER))).toEqual(
      new Set(featureKeysForPlan("pro"))
    )
  })

  it("drops to the default plan's keys once canceled", async () => {
    const svc = makeService()
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" })
    const a = await svc.getAssignment(SELLER)
    await (svc as any).updateVendorPlanAssignments([
      { id: a!.id, status: VendorPlanStatus.CANCELED },
    ])
    expect(await svc.getEntitledFeatureKeys(SELLER)).toEqual([])
  })
})

describe("applyPlanTransition", () => {
  it("upgrades immediately", async () => {
    const svc = makeService()
    const r = await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "pro",
    })
    expect(r.decision.kind).toBe("immediate")
    expect(r.assignment.plan_code).toBe("pro")
    expect(r.replayed).toBe(false)
  })

  it("parks a downgrade instead of applying it", async () => {
    const svc = makeService()
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" })

    const r = await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "starter",
    })
    expect(r.decision.kind).toBe("deferred")
    // Still on pro — the seller keeps what they paid for until period end.
    expect(r.assignment.plan_code).toBe("pro")
    expect(r.assignment.pending_plan_code).toBe("starter")
    expect(await svc.getEffectivePlanCode(SELLER)).toBe("pro")
  })

  it("rejects a move to the plan already held", async () => {
    const svc = makeService()
    const r = await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "free",
    })
    expect(r.decision.kind).toBe("rejected")
  })

  it("rejects an unknown plan without touching the assignment", async () => {
    const svc = makeService()
    const r = await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "nope",
    })
    expect(r.decision.kind).toBe("rejected")
    expect(r.assignment.plan_code).toBe("free")
  })

  it("clears a scheduled downgrade when the seller upgrades again", async () => {
    const svc = makeService()
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" })
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "starter" })
    const r = await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "scale",
    })
    expect(r.assignment.plan_code).toBe("scale")
    expect(r.assignment.pending_plan_code).toBeNull()
  })

  it("records who assigned the plan", async () => {
    const svc = makeService()
    const r = await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "pro",
      assigned_by: VendorPlanAssignedBy.ADMIN,
    })
    expect(r.assignment.assigned_by).toBe(VendorPlanAssignedBy.ADMIN)
  })

  describe("idempotency", () => {
    it("treats a replayed key as a no-op", async () => {
      // A re-delivered Stripe webhook or re-fired cron must not transition twice.
      const svc = makeService()
      const args = {
        seller_id: SELLER,
        to_plan_code: "pro",
        idempotency_key: "evt_123",
      }
      const first = await svc.applyPlanTransition(args)
      const second = await svc.applyPlanTransition(args)

      expect(first.replayed).toBe(false)
      expect(second.replayed).toBe(true)
      expect(second.decision.kind).toBe("rejected")
    })

    it("does not double-apply a replayed upgrade", async () => {
      const svc = makeService()
      await svc.applyPlanTransition({
        seller_id: SELLER,
        to_plan_code: "pro",
        idempotency_key: "evt_1",
      })
      const before = { ...(await svc.getAssignment(SELLER))! }

      await svc.applyPlanTransition({
        seller_id: SELLER,
        to_plan_code: "scale",
        idempotency_key: "evt_1",
      })
      const after = (await svc.getAssignment(SELLER))!
      expect(after.plan_code).toBe(before.plan_code)
    })

    it("allows distinct keys through", async () => {
      const svc = makeService()
      await svc.applyPlanTransition({
        seller_id: SELLER,
        to_plan_code: "starter",
        idempotency_key: "evt_a",
      })
      const r = await svc.applyPlanTransition({
        seller_id: SELLER,
        to_plan_code: "pro",
        idempotency_key: "evt_b",
      })
      expect(r.replayed).toBe(false)
      expect(r.assignment.plan_code).toBe("pro")
    })
  })
})

describe("applyPendingChange", () => {
  it("does nothing before the effective date", async () => {
    const svc = makeService()
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" })
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "starter" })
    expect(await svc.applyPendingChange(SELLER, new Date("2026-01-01"))).toBeNull()
  })

  it("applies the parked plan once due", async () => {
    const svc = makeService()
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" })
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "starter" })

    const a = (await svc.getAssignment(SELLER))!
    const due = new Date(new Date(a.pending_effective_at as Date).getTime() + 1000)

    const applied = await svc.applyPendingChange(SELLER, due)
    expect(applied!.plan_code).toBe("starter")
    expect(applied!.pending_plan_code).toBeNull()
  })

  it("is a no-op for a seller with no assignment", async () => {
    const svc = makeService()
    expect(await svc.applyPendingChange("sel_missing")).toBeNull()
  })
})

describe("planReconciliation", () => {
  it("reports the delta against what the seller currently holds", async () => {
    const svc = makeService()
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" })

    const r = await svc.planReconciliation(SELLER, ["vendor.embed"])
    expect(r.plan_code).toBe("pro")
    expect(r.to_grant).toContain("vendor.pos")
    expect(r.to_grant).not.toContain("vendor.embed")
    expect(r.to_revoke).toEqual([])
  })

  it("reports keys to revoke when the seller holds more than the plan allows", async () => {
    const svc = makeService()
    const r = await svc.planReconciliation(SELLER, ["vendor.pos"])
    expect(r.plan_code).toBe("free")
    expect(r.to_revoke).toEqual(["vendor.pos"])
  })
})

describe("cancelAtPeriodEnd", () => {
  it("schedules a drop to the default plan without applying it", async () => {
    const svc = makeService()
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" })
    const a = await svc.cancelAtPeriodEnd(SELLER, "user requested")

    expect(a.cancel_at_period_end).toBe(true)
    expect(a.pending_plan_code).toBe("free")
    expect(await svc.getEffectivePlanCode(SELLER)).toBe("pro")
  })
})
