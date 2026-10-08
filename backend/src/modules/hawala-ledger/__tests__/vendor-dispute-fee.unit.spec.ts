import {
  DISPUTE_FEE_SINK,
  VENDOR_DISPUTE_FEE_LEG,
  VENDOR_RECEIVABLE_ACCOUNT_TYPE,
  VENDOR_RECEIVABLE_OWNER_ID,
  VENDOR_REFUND_RECOVERY_LEG,
  VENDOR_REFUND_SHORTFALL_LEG,
  RECEIVABLE_LEG_TAGS,
  VendorReceivableLegError,
  assertReceivableLegTagAllowed,
  assertVendorReceivableLeg,
} from "../vendor-receivable"
import {
  CARD_PROCESSING_ACCOUNT_TYPE,
  CARD_PROCESSING_OWNER_ID,
  CARD_PROCESSING_RECOVERY_LEG,
  CARD_PROCESSING_SHORTFALL_LEG,
  computeCardProcessingReceivable,
  receivableShortfallKind,
} from "../card-processing"
import { disputeFeeCents, largestChargebackCents } from "../../../lib/card-stripe-sync"
import { allocateCents } from "../../../lib/card-dispute-fee"

/**
 * Stripe's dispute fee, owed by the vendor (operator answer 2026-10-07). The
 * leg shape the vendor receivable admits for it, how it counts as owed, how
 * the fee is read from Stripe's disputes, and how it is split. That it posts,
 * is owed, is recovered before a payout and is never reversed by a refund is
 * proved on a real database in integration-tests/http/hawala-card-stripe-sync.spec.ts.
 */

const receivable = {
  id: "acc-recv",
  account_type: VENDOR_RECEIVABLE_ACCOUNT_TYPE,
  owner_type: "SYSTEM",
  owner_id: VENDOR_RECEIVABLE_OWNER_ID,
  currency_code: "USD",
}
const processing = {
  id: "acc-proc",
  account_type: CARD_PROCESSING_ACCOUNT_TYPE,
  owner_type: "SYSTEM",
  owner_id: CARD_PROCESSING_OWNER_ID,
  currency_code: "USD",
}
const platform = { ...processing, id: "acc-plat", owner_id: "system" }
const escrow = { id: "acc-esc", account_type: "ESCROW", owner_type: "SYSTEM", owner_id: "system", currency_code: "USD" }
const fee = {
  entry_type: "ADJUSTMENT",
  reference_type: "ORDER",
  reference_id: "order_1",
  metadata: { leg: VENDOR_DISPUTE_FEE_LEG, stripe_charge_id: "ch_1" },
  vendor_dispute_fee: { order_id: "order_1", stripe_charge_id: "ch_1" },
}
const seller = { id: "acc-sel", account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_1", currency_code: "USD" }

describe("the dispute-fee leg out of the vendor receivable", () => {
  it("its sink is the card-processing account (spelled out to avoid an import cycle)", () => {
    expect(DISPUTE_FEE_SINK).toEqual({ account_type: CARD_PROCESSING_ACCOUNT_TYPE, owner_id: CARD_PROCESSING_OWNER_ID })
  })

  it("admits receivable -> card-processing account, naming the order by reference and the charge", () => {
    expect(assertVendorReceivableLeg(fee, receivable, processing)).toEqual({ side: "debit", receivableAccountId: "acc-recv" })
  })

  it.each([
    ["into the shared platform-fee account", fee, platform, /card-processing account/],
    ["into the escrow", fee, escrow, /card-processing account/],
    ["with an order_id (a refund of the order would list it)", { ...fee, order_id: "order_1" }, processing, /never by order_id/],
    ["naming no order", { ...fee, reference_id: null }, processing, /must name its order/],
    ["referencing something other than an order", { ...fee, reference_type: "MANUAL" }, processing, /must name its order/],
    ["naming no charge", { ...fee, metadata: { leg: VENDOR_DISPUTE_FEE_LEG } }, processing, /disputed charge/],
    ["as anything but an ADJUSTMENT", { ...fee, entry_type: "TRANSFER" }, processing, /only an ADJUSTMENT/],
    ["without the internal-only field (caller-supplied metadata alone)", { ...fee, vendor_dispute_fee: undefined }, processing, /only by FBM's own dispute-fee path/],
    ["for a different order than it names", { ...fee, vendor_dispute_fee: { order_id: "order_2", stripe_charge_id: "ch_1" } }, processing, /must match/],
    ["for a different charge than it names", { ...fee, vendor_dispute_fee: { order_id: "order_1", stripe_charge_id: "ch_2" } }, processing, /must match/],
  ])("refuses it %s", (_why, leg, other, message) => {
    expect(() => assertVendorReceivableLeg(leg, receivable, other)).toThrow(VendorReceivableLegError)
    expect(() => assertVendorReceivableLeg(leg, receivable, other)).toThrow(message)
  })

  it("refuses the dispute-fee tag on a leg that does not touch the receivable, without the internal field", () => {
    expect(() =>
      assertVendorReceivableLeg({ ...fee, vendor_dispute_fee: undefined }, processing, seller)
    ).toThrow(/only by FBM's own dispute-fee path/)
  })

  it("refuses the internal field on anything but a dispute-fee leg out of the receivable", () => {
    expect(() =>
      assertVendorReceivableLeg({ ...fee, metadata: { leg: "something_else" } }, processing, seller)
    ).toThrow(/must come out of the vendor receivable/)
    expect(() =>
      assertVendorReceivableLeg({ ...fee, metadata: { leg: "vendor_refund_recovery" } }, seller, receivable)
    ).toThrow(/must leave the vendor receivable, tagged as one/)
  })

  it("refuses a non-USD card-processing account", () => {
    expect(() => assertVendorReceivableLeg(fee, receivable, { ...processing, currency_code: "CCR" })).toThrow(
      /card-processing account/
    )
  })
})

describe("every receivable leg is internal-only (what the admin manual-transfer route forwards cannot write one)", () => {
  it("the reserved tags are exactly the five receivable tags (two spelled out to avoid an import cycle)", () => {
    expect([...RECEIVABLE_LEG_TAGS].sort()).toEqual(
      [
        CARD_PROCESSING_SHORTFALL_LEG,
        CARD_PROCESSING_RECOVERY_LEG,
        VENDOR_REFUND_SHORTFALL_LEG,
        VENDOR_REFUND_RECOVERY_LEG,
        VENDOR_DISPUTE_FEE_LEG,
      ].sort()
    )
  })

  it.each([...RECEIVABLE_LEG_TAGS])("refuses a %s leg without the internal marker, and admits it with", (tag) => {
    const leg = { entry_type: "ADJUSTMENT", metadata: { leg: tag } }
    expect(() => assertReceivableLegTagAllowed(leg)).toThrow(VendorReceivableLegError)
    expect(() => assertReceivableLegTagAllowed({ ...leg, receivable_leg: false })).toThrow(VendorReceivableLegError)
    expect(() => assertReceivableLegTagAllowed({ ...leg, receivable_leg: true })).not.toThrow()
  })

  it("is no business of any other leg", () => {
    expect(() => assertReceivableLegTagAllowed({ entry_type: "TRANSFER" })).not.toThrow()
    expect(() => assertReceivableLegTagAllowed({ entry_type: "FEE", metadata: { leg: "card_processing_estimate" } })).not.toThrow()
  })
})

describe("a dispute fee counts as owed, by its own kind", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "e1",
    amount: 15,
    status: "COMPLETED",
    entry_type: "ADJUSTMENT",
    debit_account_id: "acc-recv",
    credit_account_id: "acc-proc",
    reference_id: "order_1",
    created_at: "2026-10-07T00:00:00Z",
    metadata: { leg: VENDOR_DISPUTE_FEE_LEG, owed_by_account_id: "acc-sel", stripe_charge_id: "ch_1" },
    ...over,
  })

  it("is a dispute_fee shortfall, owed by the seller, on its referenced order, repaid to the receivable", () => {
    expect(receivableShortfallKind(row({}))).toBe("dispute_fee")
    const r = computeCardProcessingReceivable("acc-sel", {
      shortfalls: [row({})],
      recoveries: [
        {
          id: "r1",
          amount: 5,
          status: "COMPLETED",
          entry_type: "ADJUSTMENT",
          debit_account_id: "acc-sel",
          credit_account_id: "acc-recv",
          metadata: { leg: "vendor_refund_recovery", recovers_entry_id: "e1" },
        },
      ],
    })
    expect(r.total_cents).toBe(1000)
    expect(r.by_kind_cents).toEqual({ card_processing: 0, refund: 0, dispute_fee: 1000 })
    expect(r.open[0]).toMatchObject({ kind: "dispute_fee", order_id: "order_1", funding_account_id: "acc-recv" })
  })

  it("is forgiven at the same age as the other kinds", () => {
    const r = computeCardProcessingReceivable(
      "acc-sel",
      { shortfalls: [row({})], recoveries: [] },
      { asOfMs: new Date("2026-10-07T00:00:00Z").getTime() + 180 * 24 * 60 * 60 * 1000 }
    )
    expect(r.total_cents).toBe(0)
    expect(r.written_off).toEqual([expect.objectContaining({ kind: "dispute_fee", forgiven_cents: 1500 })])
  })
})

describe("disputeFeeCents: what Stripe kept, read off each dispute's balance transactions", () => {
  it("sums every dispute's fees, net of a returned one", () => {
    expect(
      disputeFeeCents([
        { balance_transactions: [{ fee: 1500, currency: "usd" }] },
        { balance_transactions: [{ fee: 1500, currency: "usd" }, { fee: -1500, currency: "usd" }] },
      ])
    ).toEqual({ cents: 1500, uncounted: 0 })
  })

  it("counts nothing for a dispute with no balance transactions (an inquiry)", () => {
    expect(disputeFeeCents([{ balance_transactions: [] }, {}])).toEqual({ cents: 0, uncounted: 0 })
  })

  it("does not count a non-USD balance transaction, and says so", () => {
    expect(disputeFeeCents([{ balance_transactions: [{ fee: 1500, currency: "eur" }] }])).toEqual({ cents: 0, uncounted: 1 })
  })

  it("is never below zero", () => {
    expect(disputeFeeCents([{ balance_transactions: [{ fee: -1500, currency: "usd" }] }]).cents).toBe(0)
  })
})

describe("largestChargebackCents: whether one chargeback covered the whole charge", () => {
  it("is the largest single chargeback, never a sum", () => {
    expect(largestChargebackCents([{ status: "lost", amount: 4000 }, { status: "needs_response", amount: 3000 }])).toBe(4000)
  })

  it("leaves inquiries out", () => {
    expect(largestChargebackCents([{ status: "warning_needs_response", amount: 7000 }, { status: "lost", amount: 3000 }])).toBe(3000)
    expect(largestChargebackCents([{ status: "warning_closed", amount: 7000 }])).toBe(0)
  })

  it("counts a won chargeback (the fee was still taken)", () => {
    expect(largestChargebackCents([{ status: "won", amount: 7000 }])).toBe(7000)
  })
})

describe("allocateCents: a charge's fee split across its orders", () => {
  it("in proportion, summing to the fee exactly, the odd cent to the largest remainder", () => {
    const shares = allocateCents(1500, [
      { key: "order_a", weight: 4000 },
      { key: "order_b", weight: 3000 },
    ])
    expect(Object.fromEntries(shares)).toEqual({ order_a: 857, order_b: 643 })
  })

  it("ties go to the lower key, and it always sums to the total", () => {
    const shares = allocateCents(100, [
      { key: "b", weight: 1 },
      { key: "a", weight: 1 },
      { key: "c", weight: 1 },
    ])
    expect(Object.fromEntries(shares)).toEqual({ a: 34, b: 33, c: 33 })
  })

  it("nothing to split, or no weight: nothing", () => {
    expect(allocateCents(0, [{ key: "a", weight: 1 }]).size).toBe(0)
    expect(allocateCents(100, [{ key: "a", weight: 0 }]).size).toBe(0)
  })
})
