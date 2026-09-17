import VendorPlanService from "../service";
import { VendorPlanStatus } from "../models";
import { getPlanDefinition } from "../catalog";

/**
 * Trials were advertised and never delivered.
 *
 * `trial_days` sat in the catalog and `trial_ends_at` was written, but the
 * status went straight to ACTIVE and the first period ran a full month, so the
 * change route billed the whole amount on signup. TRIALING was never written by
 * anything outside tests, which is why the renewal job's handling of it had
 * never once run.
 */
const SELLER = "sel_trial_1";
const DAY_MS = 86_400_000;

// Same in-memory harness shape as service.unit.spec.ts: the real class through
// the prototype, with the generated CRUD patched onto the instance.
function makeService(): VendorPlanService {
  const assignments: any[] = [];
  const events: any[] = [];
  const plans: any[] = [];
  const svc = Object.create(VendorPlanService.prototype) as VendorPlanService;

  const matches = (row: any, filters: Record<string, any>) =>
    Object.entries(filters).every(([k, v]) => {
      if (v === undefined) return true;
      if (v && typeof v === "object" && "$lte" in v) {
        return (
          row[k] != null &&
          new Date(row[k]).getTime() <= new Date((v as any).$lte).getTime()
        );
      }
      if (Array.isArray(v)) return v.includes(row[k]);
      return row[k] === v;
    });

  (svc as any).listVendorPlans = async (f: Record<string, any> = {}) =>
    plans.filter((r) => matches(r, f));
  (svc as any).createVendorPlans = async (e: any) => {
    const entries = Array.isArray(e) ? e : [e];
    const out = entries.map((x, i) => ({
      id: `vp_${plans.length + i + 1}`,
      ...x,
    }));
    plans.push(...out);
    return out;
  };
  (svc as any).updateVendorPlans = async (u: any) => {
    const ups = Array.isArray(u) ? u : [u];
    return ups.map((x) => {
      const r = plans.find((p) => p.id === x.id);
      if (r) Object.assign(r, x);
      return r;
    });
  };
  (svc as any).listVendorPlanAssignments = async (
    f: Record<string, any> = {},
  ) => assignments.filter((r) => matches(r, f));
  (svc as any).createVendorPlanAssignments = async (e: any) => {
    const entries = Array.isArray(e) ? e : [e];
    const out = entries.map((x, i) => ({
      id: `vpa_${assignments.length + i + 1}`,
      ...x,
    }));
    assignments.push(...out);
    return out;
  };
  (svc as any).updateVendorPlanAssignments = async (u: any) => {
    const ups = Array.isArray(u) ? u : [u];
    return ups.map((x) => {
      const r = assignments.find((a) => a.id === x.id);
      if (r) Object.assign(r, x);
      return r;
    });
  };
  (svc as any).listVendorPlanEvents = async (f: Record<string, any> = {}) =>
    events.filter((r) => matches(r, f));
  (svc as any).createVendorPlanEvents = async (e: any) => {
    const entries = Array.isArray(e) ? e : [e];
    for (const entry of entries) {
      if (
        entry.idempotency_key &&
        events.some((x) => x.idempotency_key === entry.idempotency_key)
      ) {
        const err: any = new Error("duplicate idempotency_key");
        err.code = "23505";
        throw err;
      }
    }
    const out = entries.map((x, i) => ({
      id: `vpe_${events.length + i + 1}`,
      ...x,
    }));
    events.push(...out);
    return out;
  };
  (svc as any).__state = { assignments, events, plans };
  return svc;
}

describe("vendor plan trials", () => {
  it("advertises a 30 day trial on the paid rungs that have one", () => {
    expect(getPlanDefinition("starter")?.trial_days).toBe(30);
    expect(getPlanDefinition("pro")?.trial_days).toBe(30);
    // Free has nothing to trial; scale and internal are deliberately without.
    expect(getPlanDefinition("free")?.trial_days).toBe(0);
  });

  it("starts a trial rather than going straight to active", async () => {
    const svc = makeService();
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "pro" });

    const a = await svc.getAssignment(SELLER);
    expect(a?.status).toBe(VendorPlanStatus.TRIALING);
    expect(a?.trial_ends_at).toBeTruthy();
  });

  it("ends the first period exactly when the trial ends, so the first bill lands then", async () => {
    const svc = makeService();
    const now = new Date("2026-03-01T00:00:00.000Z");
    await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "starter",
      now,
    });

    const a: any = await svc.getAssignment(SELLER);
    // A full-month first period would have the renewal job bill a month in,
    // not on the day the trial actually runs out.
    expect(new Date(a.current_period_end).toISOString()).toBe(
      new Date(now.getTime() + 30 * DAY_MS).toISOString(),
    );
    expect(new Date(a.trial_ends_at).toISOString()).toBe(
      new Date(a.current_period_end).toISOString(),
    );
  });

  it("converts to active on the rollover that raises the first charge", async () => {
    const svc = makeService();
    const start = new Date("2026-03-01T00:00:00.000Z");
    await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "pro",
      now: start,
    });

    const afterTrial = new Date(start.getTime() + 31 * DAY_MS);
    await svc.rollPeriod(SELLER, afterTrial);

    const a: any = await svc.getAssignment(SELLER);
    // Left as TRIALING it would bill every period while still reading as a
    // trial to anything that checks the status.
    expect(a.status).toBe(VendorPlanStatus.ACTIVE);
    expect(new Date(a.current_period_end).getTime()).toBeGreaterThan(
      afterTrial.getTime() - DAY_MS,
    );
  });

  it("does not convert a trial that is still running", async () => {
    const svc = makeService();
    const start = new Date("2026-03-01T00:00:00.000Z");
    await svc.applyPlanTransition({
      seller_id: SELLER,
      to_plan_code: "pro",
      now: start,
    });

    await svc.rollPeriod(SELLER, new Date(start.getTime() + 5 * DAY_MS));
    const a: any = await svc.getAssignment(SELLER);
    expect(a.status).toBe(VendorPlanStatus.TRIALING);
  });

  it("a plan with no trial is active and billable immediately", async () => {
    const svc = makeService();
    await svc.applyPlanTransition({ seller_id: SELLER, to_plan_code: "scale" });

    const a: any = await svc.getAssignment(SELLER);
    expect(a.status).toBe(VendorPlanStatus.ACTIVE);
    expect(a.trial_ends_at ?? null).toBeNull();
  });
});
