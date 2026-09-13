import {
  isDisbursementLive,
  planDisbursement,
  PATRONAGE_DISBURSEMENT_FLAG,
  type PayoutAccountRow,
} from "../patronage-disburse"
import type { PatronageAllocationRow } from "../patronage-review"

/**
 * The `queued → paid` decision.
 *
 * The refusals matter more than the happy path: this is the step that moves
 * real money to real people, and every one of these cases used to be an
 * unwritten assumption in a docblock that said the rail did not exist yet.
 */

const alloc = (over: Partial<PatronageAllocationRow> = {}): PatronageAllocationRow => ({
  id: "pa_1",
  seller_id: "sel_1",
  period_key: "2026-Q2",
  gross_volume: 1000,
  allocation_amount: 25,
  allocation_currency: "usd",
  status: "queued",
  ...over,
})

const account = (over: Partial<PayoutAccountRow> = {}): PayoutAccountRow => ({
  seller_id: "sel_1",
  provider: "stripe_connect",
  external_account_id: "acct_123",
  status: "active",
  ...over,
})

const accounts = (...rows: PayoutAccountRow[]) =>
  new Map(rows.map((r) => [r.seller_id, r]))

describe("planDisbursement", () => {
  it("pays a queued allocation with an active Stripe account", () => {
    const plan = planDisbursement("2026-Q2", [alloc()], accounts(account()))

    expect(plan.payable).toHaveLength(1)
    expect(plan.unpayable).toHaveLength(0)
    expect(plan.payable[0]).toMatchObject({
      allocation_id: "pa_1",
      seller_id: "sel_1",
      amount: 25,
      currency: "usd",
      destination_account_id: "acct_123",
    })
    expect(plan.total_payable).toBe(25)
  })

  it("derives an idempotency key from the allocation, not the run", () => {
    // Two runs of the same period must produce the same key, or a retry after
    // a partial failure pays somebody twice.
    const first = planDisbursement("2026-Q2", [alloc()], accounts(account()))
    const second = planDisbursement("2026-Q2", [alloc()], accounts(account()))

    expect(first.payable[0].idempotency_key).toBe(second.payable[0].idempotency_key)
    expect(first.payable[0].idempotency_key).toContain("pa_1")
    expect(first.payable[0].idempotency_key).toContain("2026-Q2")
  })

  it("gives different allocations different keys", () => {
    const plan = planDisbursement(
      "2026-Q2",
      [alloc({ id: "pa_1" }), alloc({ id: "pa_2", seller_id: "sel_2" })],
      accounts(account(), account({ seller_id: "sel_2" }))
    )
    const keys = new Set(plan.payable.map((p) => p.idempotency_key))
    expect(keys.size).toBe(2)
  })

  it("only touches queued rows", () => {
    const plan = planDisbursement(
      "2026-Q2",
      [
        alloc({ id: "pa_computed", status: "computed" }),
        alloc({ id: "pa_paid", status: "paid" }),
        alloc({ id: "pa_failed", status: "failed" }),
      ],
      accounts(account())
    )
    expect(plan.payable).toHaveLength(0)
    expect(plan.unpayable).toHaveLength(0)
  })

  it("refuses a seller with no payout account", () => {
    const plan = planDisbursement("2026-Q2", [alloc()], accounts())
    expect(plan.payable).toHaveLength(0)
    expect(plan.unpayable[0].reason).toMatch(/no payout account/i)
  })

  it("refuses a hawala or manual provider — Posture A names one outbound rail", () => {
    for (const provider of ["hawala", "manual"]) {
      const plan = planDisbursement(
        "2026-Q2",
        [alloc()],
        accounts(account({ provider }))
      )
      expect(plan.payable).toHaveLength(0)
      expect(plan.unpayable[0].reason).toMatch(/Stripe ACH only/i)
    }
  })

  it("refuses an account that is not active", () => {
    for (const status of ["pending", "restricted", "suspended"]) {
      const plan = planDisbursement(
        "2026-Q2",
        [alloc()],
        accounts(account({ status }))
      )
      expect(plan.payable).toHaveLength(0)
      expect(plan.unpayable[0].reason).toMatch(/not active/i)
    }
  })

  it("refuses an active account with no external id", () => {
    const plan = planDisbursement(
      "2026-Q2",
      [alloc()],
      accounts(account({ external_account_id: null }))
    )
    expect(plan.payable).toHaveLength(0)
    expect(plan.unpayable[0].reason).toMatch(/no external account id/i)
  })

  it("refuses a zero or negative amount", () => {
    for (const amount of [0, -5]) {
      const plan = planDisbursement(
        "2026-Q2",
        [alloc({ allocation_amount: amount })],
        accounts(account())
      )
      expect(plan.payable).toHaveLength(0)
      expect(plan.unpayable[0].reason).toMatch(/nothing to send/i)
    }
  })

  it("pays the good rows and reports the bad ones in the same run", () => {
    // A period must not be all-or-nothing: one seller with a broken account
    // should not hold up everyone else's refund.
    const plan = planDisbursement(
      "2026-Q2",
      [
        alloc({ id: "pa_ok", seller_id: "sel_ok" }),
        alloc({ id: "pa_bad", seller_id: "sel_bad" }),
      ],
      accounts(account({ seller_id: "sel_ok" }))
    )

    expect(plan.payable.map((p) => p.allocation_id)).toEqual(["pa_ok"])
    expect(plan.unpayable.map((p) => p.allocation_id)).toEqual(["pa_bad"])
  })

  it("reports a single currency, and null when they differ", () => {
    const same = planDisbursement(
      "2026-Q2",
      [alloc({ id: "a" }), alloc({ id: "b", seller_id: "sel_2" })],
      accounts(account(), account({ seller_id: "sel_2" }))
    )
    expect(same.currency).toBe("usd")

    const mixed = planDisbursement(
      "2026-Q2",
      [
        alloc({ id: "a" }),
        alloc({ id: "b", seller_id: "sel_2", allocation_currency: "cad" }),
      ],
      accounts(account(), account({ seller_id: "sel_2" }))
    )
    expect(mixed.currency).toBeNull()
  })
})

describe("isDisbursementLive", () => {
  it("is off unless the flag is exactly true", () => {
    expect(isDisbursementLive({})).toBe(false)
    expect(isDisbursementLive({ [PATRONAGE_DISBURSEMENT_FLAG]: "" })).toBe(false)
    expect(isDisbursementLive({ [PATRONAGE_DISBURSEMENT_FLAG]: "1" })).toBe(false)
    expect(isDisbursementLive({ [PATRONAGE_DISBURSEMENT_FLAG]: "TRUE" })).toBe(false)
    expect(isDisbursementLive({ [PATRONAGE_DISBURSEMENT_FLAG]: "yes" })).toBe(false)
  })

  it("is on for exactly true", () => {
    expect(isDisbursementLive({ [PATRONAGE_DISBURSEMENT_FLAG]: "true" })).toBe(true)
  })
})
