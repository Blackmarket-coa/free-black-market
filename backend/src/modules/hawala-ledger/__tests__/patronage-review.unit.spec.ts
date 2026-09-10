/**
 * The operator review step on patronage.
 *
 * `jobs/patronage-refund.ts` stops at `computed` "so an operator can review
 * before disbursement", and until now there was nothing to review with. What
 * these tests hold is the line the review draws: approving a period signs off
 * on the numbers and moves no money.
 * docs/TRANSMUTATION_STRATEGY.md §5.5.
 */
import {
  PatronageApprovalError,
  memberView,
  planApproval,
  summarisePeriod,
  type PatronageAllocationRow,
} from "../patronage-review"

const row = (over: Partial<PatronageAllocationRow> = {}): PatronageAllocationRow => ({
  id: "pa_1",
  seller_id: "sel_1",
  period_key: "2026-Q2",
  gross_volume: 1000,
  allocation_amount: 50,
  allocation_currency: "USD",
  status: "computed",
  ...over,
})

describe("summarisePeriod", () => {
  it("totals what the operator is about to approve", () => {
    const summary = summarisePeriod("2026-Q2", [
      row({ id: "a", seller_id: "sel_1", allocation_amount: 50 }),
      row({ id: "b", seller_id: "sel_2", allocation_amount: 25.5 }),
    ])
    expect(summary.allocation_count).toBe(2)
    expect(summary.seller_count).toBe(2)
    expect(summary.total_allocated).toBe(75.5)
    expect(summary.currency).toBe("USD")
    expect(summary.approvable).toBe(true)
  })

  it("counts each status", () => {
    const summary = summarisePeriod("2026-Q2", [
      row({ id: "a", status: "computed" }),
      row({ id: "b", status: "queued" }),
      row({ id: "c", status: "queued" }),
      row({ id: "d", status: "paid" }),
    ])
    expect(summary.by_status).toEqual({ computed: 1, queued: 2, paid: 1 })
  })

  it("reports no currency rather than a wrong total when a period mixes them", () => {
    // A single number across two currencies is wrong, not rounded.
    const summary = summarisePeriod("2026-Q2", [
      row({ id: "a", allocation_currency: "USD" }),
      row({ id: "b", allocation_currency: "EUR" }),
    ])
    expect(summary.currency).toBeNull()
  })

  it("is not approvable when nothing is computed", () => {
    expect(summarisePeriod("2026-Q2", [row({ status: "paid" })]).approvable).toBe(false)
    expect(summarisePeriod("2026-Q2", []).approvable).toBe(false)
  })
})

describe("planApproval", () => {
  it("queues only the computed rows", () => {
    const plan = planApproval("2026-Q2", [
      row({ id: "a", status: "computed" }),
      row({ id: "b", status: "queued" }),
      row({ id: "c", status: "paid" }),
    ])
    expect(plan.toQueue.map((r) => r.id)).toEqual(["a"])
    expect(plan.alreadyQueued).toBe(1)
    expect(plan.paid).toBe(1)
  })

  it("never re-queues an already-paid allocation", () => {
    // The failure that would matter: paying somebody twice.
    const plan = planApproval("2026-Q2", [
      row({ id: "a", status: "computed" }),
      row({ id: "paid_one", status: "paid" }),
    ])
    expect(plan.toQueue.map((r) => r.id)).not.toContain("paid_one")
  })

  it("finishes a partially-approved period on retry", () => {
    // A retry after a partial failure should complete the job, not refuse it.
    const plan = planApproval("2026-Q2", [
      row({ id: "a", status: "queued" }),
      row({ id: "b", status: "computed" }),
    ])
    expect(plan.toQueue.map((r) => r.id)).toEqual(["b"])
  })

  it("refuses a period with nothing computed rather than succeeding silently", () => {
    expect(() =>
      planApproval("2026-Q2", [row({ status: "queued" }), row({ id: "b", status: "paid" })])
    ).toThrow(PatronageApprovalError)
  })

  it("refuses a period that was never computed", () => {
    expect(() => planApproval("2026-Q9", [])).toThrow(/Nothing to approve/)
  })

  it("names the period in the refusal", () => {
    expect(() => planApproval("2026-Q2", [row({ status: "paid" })])).toThrow(/2026-Q2/)
  })
})

describe("memberView", () => {
  it("does not tell a vendor an approved refund is on its way", () => {
    // No disbursement rail exists. Saying "payment is on its way" would be
    // the kind of claim this codebase keeps having to retract.
    const view = memberView(row({ status: "queued" }))
    expect(view.explanation).toMatch(/not yet paid/i)
    expect(view.explanation).toMatch(/not automated/i)
  })

  it("explains a computed allocation as awaiting review", () => {
    expect(memberView(row({ status: "computed" })).explanation).toMatch(/review/i)
  })

  it("reports a paid allocation plainly", () => {
    const view = memberView({ ...row({ status: "paid" }), paid_at: "2026-07-01T00:00:00.000Z" })
    expect(view.status).toBe("paid")
    expect(view.paid_at).toBe("2026-07-01T00:00:00.000Z")
  })

  it("does not invent an explanation for an unrecognised status", () => {
    expect(memberView(row({ status: "weird" })).explanation).toMatch(/unrecognised/i)
  })

  it("carries no seller id or row id to the member", () => {
    // A vendor's own view needs neither, and both are internal handles.
    const view = memberView(row())
    expect(view).not.toHaveProperty("seller_id")
    expect(view).not.toHaveProperty("id")
  })
})
