import { CommissionStatus } from "../models/order-attribution"
import {
  CORRECTED_METADATA_KEY,
  PAYOUT_WINDOW_MS,
  planCommissionMinorUnitCorrection,
  reviewVendorDebit,
  vendorsDebitedOnApproval,
  type CommissionMinorUnitCorrection,
  type StoredAttributionAmounts,
  type VendorDebitContext,
} from "../minor-unit-correction"
import { AMOUNT_UNIT_METADATA_KEY, AMOUNT_UNIT_MINOR } from "../../../shared/minor-units"

/**
 * SD-95: which stored attribution rows the corrective script may rewrite.
 * The old subscriber stored Medusa's major-unit subtotal as cents, so a $25
 * order at 10% has subtotal/basis 25 and commission 2 where 2500/250 is right.
 */

const legacyRow = (over: Partial<StoredAttributionAmounts> = {}): StoredAttributionAmounts => ({
  id: "oatt_1",
  order_id: "order_1",
  level: 1,
  commission_status: CommissionStatus.HELD,
  ledger_entry_id: null,
  attributed_subtotal_cents: 25,
  commission_basis_cents: 25,
  commission_amount_cents: 2,
  commission_percent: 10,
  level_split_percent: 80,
  currency_code: "usd",
  metadata: null,
  ...over,
})

const usd25 = { subtotal: 25, total: 25, currency_code: "usd" }

describe("planCommissionMinorUnitCorrection", () => {
  it("corrects a $25 order at 10%: subtotal 25 → 2500, commission 2 → 250", () => {
    expect(planCommissionMinorUnitCorrection([legacyRow()], usd25)).toEqual({
      action: "correct",
      subtotal: { from: 25, to: 2500 },
      commission_total: { from: 2, to: 250 },
      rows: [{ id: "oatt_1", level: 1, status: "held", commission: { from: 2, to: 250 } }],
    })
  })

  it("reads NUMERIC percents as Postgres returns them, strings", () => {
    const plan = planCommissionMinorUnitCorrection(
      [legacyRow({ commission_percent: "10", level_split_percent: "80", attributed_subtotal_cents: "25", commission_basis_cents: "25", commission_amount_cents: "2" })],
      usd25
    )
    expect(plan).toMatchObject({ action: "correct", commission_total: { from: 2, to: 250 } })
  })

  it("reads the subtotal the way the old subscriber did, cents included: $25.99 → 2599, commission 2 → 259", () => {
    const plan = planCommissionMinorUnitCorrection(
      [legacyRow({ attributed_subtotal_cents: "25.99", commission_basis_cents: "25.99", commission_amount_cents: "2" })],
      { subtotal: 25.99, total: 27.5, currency_code: "usd" }
    )
    expect(plan).toMatchObject({ action: "correct", subtotal: { from: 25.99, to: 2599 }, commission_total: { from: 2, to: 259 } })
  })

  it("re-splits a three-level chain from its stored splits, so the levels still add up", () => {
    // Old: floor(100 × 10 / 100) = 10 → 80/15/5 → 8, 1, 0, remainder 1 to L1 → 9, 1, 0.
    // New: $100 is 10000 cents; 10% = 1000 → 800, 150, 50.
    const rows = [
      legacyRow({ id: "a", level: 1, attributed_subtotal_cents: 100, commission_basis_cents: 100, commission_amount_cents: 9 }),
      legacyRow({ id: "b", level: 2, level_split_percent: "15", attributed_subtotal_cents: 100, commission_basis_cents: 100, commission_amount_cents: 1 }),
      legacyRow({ id: "c", level: 3, level_split_percent: "5", attributed_subtotal_cents: 100, commission_basis_cents: 100, commission_amount_cents: 0 }),
    ]
    const plan = planCommissionMinorUnitCorrection(rows, { subtotal: 100, currency_code: "usd" })
    expect(plan).toMatchObject({ action: "correct", commission_total: { from: 10, to: 1000 } })
    if (plan.action !== "correct") throw new Error("expected correct")
    expect(plan.rows.map((r) => [r.id, r.commission.from, r.commission.to])).toEqual([
      ["a", 9, 800],
      ["b", 1, 150],
      ["c", 0, 50],
    ])
  })

  it("corrects a row reversed or disqualified while held: no money moved, only the record", () => {
    for (const status of [CommissionStatus.REVERSED, CommissionStatus.DISQUALIFIED, CommissionStatus.PENDING]) {
      expect(planCommissionMinorUnitCorrection([legacyRow({ commission_status: status })], usd25)).toMatchObject({
        action: "correct",
      })
    }
  })

  it("never touches a commission already credited to the ledger: listed for the operator with both figures", () => {
    const plan = planCommissionMinorUnitCorrection(
      [legacyRow({ commission_status: CommissionStatus.APPROVED, ledger_entry_id: "hle_1" })],
      usd25
    )
    expect(plan.action).toBe("review")
    if (plan.action !== "review") throw new Error("expected review")
    expect(plan.reason).toContain("approved with ledger entry hle_1")
    expect(plan.reason).toContain("old figure 2")
    expect(plan.reason).toContain("right figure is 250")
  })

  it("never touches a zero-cent approval either (approved with no ledger entry, nothing ever credited)", () => {
    const plan = planCommissionMinorUnitCorrection(
      [
        legacyRow({
          commission_status: CommissionStatus.APPROVED,
          ledger_entry_id: "",
          attributed_subtotal_cents: 5,
          commission_basis_cents: 5,
          commission_amount_cents: 0,
        }),
      ],
      { subtotal: 5, currency_code: "usd" }
    )
    expect(plan.action).toBe("review")
  })

  it("skips a row the fixed subscriber wrote (marked), whatever its figures", () => {
    const marked = legacyRow({ metadata: { [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR } })
    expect(planCommissionMinorUnitCorrection([marked], usd25)).toEqual({ action: "skip", reason: "marked_minor_units" })
  })

  it("skips a row already corrected, so a second run does nothing", () => {
    const done = legacyRow({ metadata: { [CORRECTED_METADATA_KEY]: { at: "x" } } })
    expect(planCommissionMinorUnitCorrection([done], usd25)).toEqual({ action: "skip", reason: "already_corrected" })
  })

  it("skips an unmarked row already in minor units", () => {
    const right = legacyRow({ attributed_subtotal_cents: 2500, commission_basis_cents: 2500, commission_amount_cents: 250 })
    expect(planCommissionMinorUnitCorrection([right], usd25)).toEqual({ action: "skip", reason: "already_minor_units" })
  })

  it("skips a currency with no minor unit: JPY rows were right all along", () => {
    const yen = legacyRow({ currency_code: "jpy", attributed_subtotal_cents: 5000, commission_basis_cents: 5000, commission_amount_cents: 500 })
    expect(planCommissionMinorUnitCorrection([yen], { subtotal: 5000, currency_code: "jpy" })).toEqual({
      action: "skip",
      reason: "no_difference",
    })
  })

  it("sends an order edited since attribution to review instead of guessing", () => {
    const plan = planCommissionMinorUnitCorrection([legacyRow()], { subtotal: 30, currency_code: "usd" })
    expect(plan.action).toBe("review")
  })

  it("sends a commission that is not what the old code stored to review", () => {
    expect(planCommissionMinorUnitCorrection([legacyRow({ commission_amount_cents: 3 })], usd25).action).toBe("review")
    expect(planCommissionMinorUnitCorrection([legacyRow({ commission_percent: null })], usd25).action).toBe("review")
  })

  it("sends a missing order, a broken chain or a split mark to review", () => {
    expect(planCommissionMinorUnitCorrection([legacyRow()], null).action).toBe("review")
    expect(planCommissionMinorUnitCorrection([legacyRow({ level: 2 })], usd25).action).toBe("review")
    const half = [
      legacyRow({ id: "a", level: 1 }),
      legacyRow({ id: "b", level: 2, metadata: { [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR } }),
    ]
    expect(planCommissionMinorUnitCorrection(half, usd25).action).toBe("review")
  })

  it("sends a currency mismatch to review", () => {
    expect(planCommissionMinorUnitCorrection([legacyRow()], { subtotal: 25, currency_code: "eur" }).action).toBe("review")
  })
})

/**
 * Correcting a held row raises what approve-held later debits from the
 * vendor (settlement never carved the commission out). These orders are
 * listed instead of corrected. The check speaks for the moment it is made
 * (`checked_at`); it cannot see a payout made after it.
 */
describe("reviewVendorDebit", () => {
  const row = (over: Partial<StoredAttributionAmounts> = {}) => legacyRow({ vendor_id: "sel_vendor", ...over })
  const PLACED = "2026-10-01T12:00:00.000Z"
  const after = (ms: number) => new Date(Date.parse(PLACED) + ms).toISOString()
  const clean: VendorDebitContext = {
    order_seller_id: "sel_vendor",
    order_placed_at: PLACED,
    checked_at: after(30 * 24 * 60 * 60 * 1000),
    order_payout_ids: [],
    order_settled_to_vendor: { sel_vendor: true },
    vendor_withdrawals: { sel_vendor: [] },
  }
  const planFor = (rows: StoredAttributionAmounts[]) => {
    const plan = planCommissionMinorUnitCorrection(rows, usd25) as CommissionMinorUnitCorrection
    if (plan.action !== "correct") throw new Error(`expected a correction, got ${JSON.stringify(plan)}`)
    return plan
  }

  it("lets the correction go ahead when the vendor sold the order, its proceeds reached them, and they have not been paid out since", () => {
    const rows = [row()]
    expect(vendorsDebitedOnApproval(rows)).toEqual(["sel_vendor"])
    expect(reviewVendorDebit(planFor(rows), rows, clean)).toBeNull()
  })

  it("lists an order whose vendor was paid out after it was placed, naming the payout and the raised debit", () => {
    const rows = [row()]
    const reason = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      vendor_withdrawals: { sel_vendor: [{ id: "pr_1", kind: "payout request", status: "COMPLETED" }] },
    })
    expect(reason).toContain("vendor sel_vendor has been paid out since the order was placed (payout request pr_1 COMPLETED")
    expect(reason).toContain("from 2 to 250")
    expect(reason).toContain("Operator decision")
  })

  it("lists an order whose attributed vendor is not its seller, or which has no seller", () => {
    const rows = [row()]
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_seller_id: "sel_other" })).toContain(
      "the attributed vendor sel_vendor is not the order's seller sel_other"
    )
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_seller_id: null })).toContain("the order has no seller")
  })

  it("lists an order whose proceeds never reached the vendor's earnings: no settlement leg credits them", () => {
    const rows = [row()]
    const never = "the order's proceeds never reached vendor sel_vendor's earnings in the ledger"
    const reason = reviewVendorDebit(planFor(rows), rows, { ...clean, order_settled_to_vendor: { sel_vendor: false } })
    expect(reason).toContain(never)
    expect(reason).toContain("from 2 to 250")
    // A vendor the script did not answer for counts as not settled, and
    // another vendor's settlement does not stand in for this one's.
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_settled_to_vendor: {} })).toContain(never)
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_settled_to_vendor: { sel_consignor: true } })).toContain(never)
  })

  it("lists an order placed inside the payout window that Mercur has not paid yet; one exactly at the window's end passes", () => {
    const rows = [row()]
    const recent = "inside the 48 hours in which the nightly payout sends an order's proceeds to its vendor"
    expect(PAYOUT_WINDOW_MS).toBe(2 * 24 * 60 * 60 * 1000)
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(60 * 60 * 1000) })).toContain(
      `the order was placed 1 hours before this check, ${recent}, and no payout for it exists yet`
    )
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(PAYOUT_WINDOW_MS - 1) })).toContain(recent)
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(PAYOUT_WINDOW_MS) })).toBeNull()
    // A check time before the placement, or one that cannot be read, lists it too.
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(-1000) })).toContain(recent)
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: "not a date" })).toContain("an unknown time")
  })

  it("names the Mercur payout, not the window, for a recent order Mercur already paid", () => {
    const rows = [row()]
    const reason = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      checked_at: after(60 * 60 * 1000),
      order_payout_ids: ["pout_1"],
    })
    expect(reason).toContain("Mercur payout pout_1")
    expect(reason).not.toContain("nightly payout")
  })

  it("lists an order whose proceeds Mercur already paid out, or whose placement time is unknown", () => {
    const rows = [row()]
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_payout_ids: ["pout_1"] })).toContain("Mercur payout pout_1")
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_placed_at: null })).toContain("placement time is unknown")
  })

  it("passes rows approve-held will never credit (reversed, disqualified, no vendor) whatever the vendor's payouts", () => {
    const paidOut: VendorDebitContext = {
      ...clean,
      order_seller_id: "sel_other",
      checked_at: after(60 * 60 * 1000),
      order_settled_to_vendor: {},
      vendor_withdrawals: { sel_vendor: [{ id: "pr_1", kind: "payout request", status: "COMPLETED" }] },
    }
    for (const rows of [
      [row({ commission_status: CommissionStatus.REVERSED })],
      [row({ commission_status: CommissionStatus.DISQUALIFIED })],
      [row({ vendor_id: null })],
    ]) {
      expect(vendorsDebitedOnApproval(rows)).toEqual([])
      expect(reviewVendorDebit(planFor(rows), rows, paidOut)).toBeNull()
    }
  })

  it("counts a pending row as one approve-held will credit", () => {
    const rows = [row({ commission_status: CommissionStatus.PENDING })]
    expect(vendorsDebitedOnApproval(rows)).toEqual(["sel_vendor"])
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_seller_id: "sel_other" })).not.toBeNull()
  })
})
