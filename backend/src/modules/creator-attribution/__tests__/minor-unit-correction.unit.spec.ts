import { CommissionStatus } from "../models/order-attribution"
import {
  CORRECTED_METADATA_KEY,
  planCommissionMinorUnitCorrection,
  type StoredAttributionAmounts,
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
