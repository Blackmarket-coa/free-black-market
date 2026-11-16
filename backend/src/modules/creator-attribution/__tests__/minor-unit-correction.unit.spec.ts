import { CommissionStatus } from "../models/order-attribution"
import {
  CORRECTED_METADATA_KEY,
  PAYOUT_WINDOW_MS,
  planCommissionMinorUnitCorrection,
  reviewVendorDebit,
  vendorsDebitedOnApproval,
  type CommissionMinorUnitCorrection,
  type OrderPaymentSide,
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
  /** A card order's payment records with nothing refunded: $25 captured on its own collection. */
  const paidByCard: OrderPaymentSide = {
    funding: "fbm_card",
    payment_collection_ids: ["pay_col_1"],
    captured: 25,
    refunded: 0,
    unattributed_refund: null,
    dispute_open: 0,
  }
  const clean: VendorDebitContext = {
    order_seller_id: "sel_vendor",
    order_placed_at: PLACED,
    checked_at: after(30 * 24 * 60 * 60 * 1000),
    order_payout_ids: [],
    order_settled_to_vendor: { sel_vendor: true },
    // Captured at placement: the order settled the moment it was placed.
    order_settled_at: { sel_vendor: PLACED },
    order_settlement_reversed: {},
    order_refunds: [],
    order_payment: paidByCard,
    // The one collection linked to the order is the one its records were read from.
    order_payment_collection_ids: ["pay_col_1"],
    // Nothing sits under the key approve-held credits the order's rows with.
    order_commission_entries: [],
    vendor_withdrawals: { sel_vendor: [] },
    vendor_other_debits: { sel_vendor: [] },
    vendor_unconfirmed_debits: { sel_vendor: [] },
  }
  const DAY = 24 * 60 * 60 * 1000
  const planFor = (rows: StoredAttributionAmounts[]) => {
    const plan = planCommissionMinorUnitCorrection(rows, usd25) as CommissionMinorUnitCorrection
    if (plan.action !== "correct") throw new Error(`expected a correction, got ${JSON.stringify(plan)}`)
    return plan
  }

  it("lets the correction go ahead when the vendor sold the order, its proceeds reached them, it was not refunded, and they have not been paid out since", () => {
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

  it("says a refund reversed the proceeds, not that they never arrived, when the vendor's settlement leg is REVERSED", () => {
    const rows = [row()]
    const reason = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      order_settled_to_vendor: { sel_vendor: false },
      order_settled_at: { sel_vendor: null },
      order_settlement_reversed: { sel_vendor: true },
    })
    expect(reason).toContain(
      "the order's proceeds reached vendor sel_vendor's earnings in the ledger and a refund reversed them (its settlement leg is REVERSED)"
    )
    expect(reason).not.toContain("never reached")
    // A reversed leg never stands in for one that moved money: with the
    // vendor still settled by another leg, the order passes.
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_settlement_reversed: { sel_vendor: true } })).toBeNull()
  })

  it("lists an order refunded in the ledger while its attribution is still held, naming the refund legs", () => {
    const rows = [row()]
    const off = (id: string, amount = 19.4) => ({ id, status: "COMPLETED", amount, from_vendor_id: "sel_vendor" })
    const other = (id: string, amount = 20) => ({ id, status: "COMPLETED", amount, from_vendor_id: null })
    const fromVendor = "the order was refunded out of vendor sel_vendor's earnings (refund leg hle_r1 19.4 COMPLETED)"
    const notReversed = "and its attribution was not reversed (a refund does not reverse a held attribution; only a cancellation does)"

    // A card order refunded in part: the seller's share came out of the
    // vendor's earnings and the settlement leg is still COMPLETED.
    const partial = reviewVendorDebit(planFor(rows), rows, { ...clean, order_refunds: [other("hle_fee", 0.6), off("hle_r1"), other("hle_cust")] })
    expect(partial).toContain(`${fromVendor} ${notReversed}`)
    expect(partial).toContain("from 2 to 250")
    expect(partial).not.toContain("with nothing taken from")

    // Refunded with nothing taken from the vendor (they held nothing; the
    // ledger records it as owed): still a refund of an order whose row is held.
    const owed = reviewVendorDebit(planFor(rows), rows, { ...clean, order_refunds: [other("hle_fee", 0.6), other("hle_cust")] })
    expect(owed).toContain(
      `the order was refunded in the ledger (refund leg hle_fee 0.6 COMPLETED, refund leg hle_cust 20 COMPLETED) ` +
        `with nothing taken from sel_vendor's earnings, ${notReversed}`
    )
    // A leg off another vendor's earnings is not this vendor's.
    expect(
      reviewVendorDebit(planFor(rows), rows, { ...clean, order_refunds: [{ ...off("hle_r1"), from_vendor_id: "sel_other" }] })
    ).toContain("with nothing taken from sel_vendor's earnings")

    // More than three are cut short.
    const many = reviewVendorDebit(planFor(rows), rows, { ...clean, order_refunds: ["a", "b", "c", "d"].map((id) => off(`hle_${id}`, 1)) })
    expect(many).toContain("(refund leg hle_a 1 COMPLETED, refund leg hle_b 1 COMPLETED, refund leg hle_c 1 COMPLETED, …)")
  })

  it("lists an order its payment records show refunded when the ledger has posted no refund leg for it", () => {
    const rows = [row()]
    const notReversed = "its attribution was not reversed (a refund does not reverse a held attribution; only a cancellation does)"
    const pay = (over: Partial<OrderPaymentSide>): VendorDebitContext => ({ ...clean, order_payment: { ...paidByCard, ...over } })

    // Refunded on the order's own record (its split row, or its own
    // collection) and not in the ledger: a split-row refund the reconciler
    // has not posted, or one it does not post once the legs are SETTLED.
    const unposted = reviewVendorDebit(planFor(rows), rows, pay({ refunded: 20 }))
    expect(unposted).toContain(
      `the order's payment records show 20 refunded of 25 captured and the ledger has posted no refund leg for it ` +
        `(the reconciler has not posted it yet, or does not post it), and ${notReversed}`
    )
    expect(unposted).toContain("from 2 to 250")
    // The smallest refund lists it; none does not.
    expect(reviewVendorDebit(planFor(rows), rows, pay({ refunded: 0.01 }))).toContain("show 0.01 refunded of 25 captured")
    expect(reviewVendorDebit(planFor(rows), rows, pay({ refunded: 0 }))).toBeNull()
    // No captured figure to set it against.
    expect(reviewVendorDebit(planFor(rows), rows, pay({ refunded: 20, captured: null }))).toContain(
      "the order's payment records show 20 refunded and the ledger has posted no refund leg for it"
    )

    // The ledger posted it too: both are said, and the payment line does
    // not claim the ledger is missing it.
    const posted = reviewVendorDebit(planFor(rows), rows, {
      ...pay({ refunded: 20 }),
      order_refunds: [{ id: "hle_r1", status: "COMPLETED", amount: 19.4, from_vendor_id: "sel_vendor" }],
    })
    expect(posted).toContain("the order was refunded out of vendor sel_vendor's earnings (refund leg hle_r1 19.4 COMPLETED)")
    expect(posted).toContain("; the order's payment records show 20 refunded of 25 captured. Correcting would raise")
    expect(posted).not.toContain("has posted no refund leg")
  })

  it("lists an order when a refund on its payment collection is recorded on no order, or a card dispute is open on it", () => {
    const rows = [row()]
    const pay = (over: Partial<OrderPaymentSide>): VendorDebitContext => ({ ...clean, order_payment: { ...paidByCard, ...over } })

    // Medusa's own refund on a storefront order: on the shared collection,
    // on no split row, and so not in the ledger and not this order's
    // `refunded` either.
    const unassigned = reviewVendorDebit(planFor(rows), rows, pay({ refunded: 0, unattributed_refund: 20 }))
    expect(unassigned).toContain(
      "20 was refunded on the order's payment collection pay_col_1 and is recorded on no order " +
        "(Medusa's own refund on a storefront order, or a refund made in Stripe: the ledger posts nothing for it until " +
        "an admin assigns it to the sellers' orders), so some or all of it may be this order's, and its attribution was not reversed"
    )
    expect(unassigned).toContain("from 2 to 250")
    expect(reviewVendorDebit(planFor(rows), rows, pay({ unattributed_refund: 0.01 }))).toContain("0.01 was refunded on the order's payment collection")
    expect(reviewVendorDebit(planFor(rows), rows, pay({ unattributed_refund: 0 }))).toBeNull()
    expect(reviewVendorDebit(planFor(rows), rows, pay({ unattributed_refund: null }))).toBeNull()
    // A figure that cannot be read is not "none".
    expect(reviewVendorDebit(planFor(rows), rows, pay({ unattributed_refund: NaN }))).toContain(
      "an unreadable amount was refunded on the order's payment collection pay_col_1"
    )

    const disputed = reviewVendorDebit(planFor(rows), rows, pay({ dispute_open: 25 }))
    expect(disputed).toContain(
      "a card dispute holding 25 is open on the order's payment collection pay_col_1: " +
        "the ledger posts no refund for it while it is open, and a dispute lost is a refund of the order"
    )
    expect(reviewVendorDebit(planFor(rows), rows, pay({ dispute_open: 0.01 }))).toContain("a card dispute holding 0.01 is open")
    for (const dispute_open of [NaN, undefined as unknown as number]) {
      expect(reviewVendorDebit(planFor(rows), rows, pay({ dispute_open }))).toContain("a card dispute holding an unreadable amount is open")
    }
  })

  it("lists an order whose payment records could not be read, are not a card payment's, or put no amount on the order", () => {
    const rows = [row()]
    const cannotShow = "so it cannot be shown that the order was not refunded"

    // The read failed or returned nothing; a context built with no payment
    // side at all is read the same way.
    expect(
      reviewVendorDebit(planFor(rows), rows, { ...clean, order_payment: null, order_payment_unread: "the read failed: boom" })
    ).toContain(`the order's payment records could not be read (the read failed: boom), ${cannotShow}`)
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_payment: null })).toContain(
      `the order's payment records could not be read (the read returned nothing), ${cannotShow}`
    )
    const { order_payment: _none, ...withoutPaymentSide } = clean
    expect(reviewVendorDebit(planFor(rows), rows, withoutPaymentSide as VendorDebitContext)).toContain("could not be read")

    // Not paid through FBM's card account. With no payment collection the
    // read gives no captured or refunded amount; with one of another
    // provider it gives that collection's, and a 0 there is still not taken
    // as "not refunded".
    const unpaid = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      order_payment: { ...paidByCard, funding: "other", payment_collection_ids: [], captured: null, refunded: null },
      order_payment_collection_ids: [],
    })
    expect(unpaid).toContain(
      `the order was not paid through FBM's own card account (its payment reads as "other"; it has no payment collection), ` +
        `so its payment records cannot show that it was not refunded. Correcting would raise`
    )
    // No collection linked and none read from: that alone is no reason.
    expect(unpaid).not.toContain("was not read")
    expect(unpaid).not.toContain("not among")
    for (const funding of ["other", "connect_direct"]) {
      const reason = reviewVendorDebit(planFor(rows), rows, { ...clean, order_payment: { ...paidByCard, funding } })
      expect(reason).toContain(`(its payment reads as "${funding}"; payment collection pay_col_1)`)
    }

    // A card payment whose collection is shared with other orders and has no
    // per-order record: no amount is this order's.
    const shared = reviewVendorDebit(planFor(rows), rows, { ...clean, order_payment: { ...paidByCard, captured: null, refunded: null } })
    expect(shared).toContain(
      "what was refunded for the order cannot be read from its payment records " +
        "(payment collection pay_col_1 carries no amount that is this order's alone), so it cannot be shown that it was not refunded"
    )
    expect(
      reviewVendorDebit(planFor(rows), rows, { ...clean, order_payment: { ...paidByCard, refunded: NaN } })
    ).toContain("what was refunded for the order cannot be read")
  })

  it("lists an order with a payment collection its payment records were not read from, or whose linked collections are unknown", () => {
    const rows = [row()]
    const linked = (order_payment_collection_ids: VendorDebitContext["order_payment_collection_ids"], readFrom = ["pay_col_1"]) =>
      reviewVendorDebit(planFor(rows), rows, {
        ...clean,
        order_payment: { ...paidByCard, payment_collection_ids: readFrom },
        order_payment_collection_ids,
      })

    // A storefront order's records come from the collection its split row
    // names. A second collection of the order's (a further payment taken
    // after an order change) was not read, and a refund there is unseen.
    const second = linked(["pay_col_1", "pay_col_2"])
    expect(second).toBe(
      "payment collection pay_col_2 of the order's was not read: its payment records were read from payment collection pay_col_1 only " +
        "(a storefront order's are read from the collection its split payment row names), so a refund made on it is not seen. " +
        "Correcting would raise what the approve-held job debits from sel_vendor's current earnings for this order from 2 to 250 once commission " +
        "crediting works. Operator decision, not changed here"
    )
    // Several, each named once.
    expect(linked(["pay_col_3", "pay_col_1", "pay_col_2", "pay_col_3"])).toContain(
      "payment collections pay_col_3, pay_col_2 of the order's were not read: its payment records were read from payment collection pay_col_1 only " +
        "(a storefront order's are read from the collection its split payment row names), so a refund made on them is not seen"
    )
    // Linked to a collection, read from none.
    expect(linked(["pay_col_1"], [])).toContain(
      "payment collection pay_col_1 of the order's was not read: its payment records were read from no payment collection only"
    )

    // Read from a collection the order is not linked to.
    expect(linked([])).toContain(
      "the order's payment records were read from payment collection pay_col_1, which is not among the collections linked to the order (it has none), " +
        "so they may not be this order's"
    )
    const swapped = linked(["pay_col_2"])
    expect(swapped).toContain("payment collection pay_col_2 of the order's was not read")
    expect(swapped).toContain(
      "the order's payment records were read from payment collection pay_col_1, which is not among the collections linked to the order (pay_col_2)"
    )

    // The links could not be read; a context built with none is read the same way.
    const unknown =
      "the payment collections linked to the order could not be read, so it cannot be shown that its payment records cover every one of them"
    expect(linked(null)).toContain(unknown)
    const { order_payment_collection_ids: _none, ...withoutLinks } = clean
    expect(reviewVendorDebit(planFor(rows), rows, withoutLinks as VendorDebitContext)).toContain(unknown)

    // The same collections on both sides pass, in any order and named twice.
    expect(linked(["pay_col_1"])).toBeNull()
    expect(linked(["pay_col_1", "pay_col_1"])).toBeNull()
    expect(linked(["pay_col_2", "pay_col_1"], ["pay_col_1", "pay_col_2"])).toBeNull()
  })

  it("lists an order whose vendor's earnings were debited since it was placed by any other leg, named as the script named it", () => {
    const rows = [row()]
    const reason = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      vendor_other_debits: {
        sel_vendor: [
          { id: "hle_pool", kind: "TRANSFER leg for CREATOR_REWARD_POOL", status: "COMPLETED" },
          { id: "hle_adj", kind: "adjustment", status: "SETTLED" },
        ],
      },
    })
    expect(reason).toBe(
      "vendor sel_vendor's earnings were drawn on since the order was placed " +
        "(TRANSFER leg for CREATOR_REWARD_POOL hle_pool COMPLETED, adjustment hle_adj SETTLED), " +
        "and the commission was never carved out of what was taken. " +
        "Correcting would raise what the approve-held job debits from sel_vendor's current earnings for this order from 2 to 250 once commission " +
        "crediting works. Operator decision, not changed here"
    )
    expect(reason).not.toContain("has been paid out")
    // Another vendor's debits are not this vendor's; a vendor the script
    // did not answer for has none.
    expect(
      reviewVendorDebit(planFor(rows), rows, {
        ...clean,
        vendor_other_debits: { sel_other: [{ id: "hle_adj", kind: "adjustment", status: "COMPLETED" }] },
      })
    ).toBeNull()
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, vendor_other_debits: {} })).toBeNull()
    // More than three are cut short.
    const many = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      vendor_other_debits: { sel_vendor: ["a", "b", "c", "d"].map((id) => ({ id: `hle_${id}`, kind: "CORRECTION leg", status: "COMPLETED" })) },
    })
    expect(many).toContain("(CORRECTION leg hle_a COMPLETED, CORRECTION leg hle_b COMPLETED, CORRECTION leg hle_c COMPLETED, …), and the commission")
  })

  it("lists an order whose vendor's earnings carry a debit since it was placed that is neither COMPLETED nor SETTLED, worded as a debit the ledger cannot vouch for", () => {
    const rows = [row()]
    const reason = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      vendor_unconfirmed_debits: {
        sel_vendor: [
          { id: "hle_w", kind: "withdrawal", status: "PENDING" },
          { id: "hle_cc", kind: "CREATOR_COMMISSION leg of order order_2", status: "REVERSED" },
        ],
      },
    })
    expect(reason).toBe(
      "vendor sel_vendor's earnings have a debit written since the order was placed that is neither COMPLETED nor SETTLED " +
        "(withdrawal hle_w PENDING, CREATOR_COMMISSION leg of order order_2 hle_cc REVERSED), " +
        "so whether that money moved, or stayed moved, cannot be read from the ledger. " +
        "Correcting would raise what the approve-held job debits from sel_vendor's current earnings for this order from 2 to 250 once commission " +
        "crediting works. Operator decision, not changed here"
    )
    // Not said to be a payout, and not said to be money taken.
    expect(reason).not.toContain("has been paid out")
    expect(reason).not.toContain("earnings were drawn on")
    // Another vendor's are not this vendor's; a vendor the script did not
    // answer for has none.
    expect(
      reviewVendorDebit(planFor(rows), rows, {
        ...clean,
        vendor_unconfirmed_debits: { sel_other: [{ id: "hle_w", kind: "withdrawal", status: "PENDING" }] },
      })
    ).toBeNull()
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, vendor_unconfirmed_debits: {} })).toBeNull()
    // More than three are cut short.
    const many = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      vendor_unconfirmed_debits: { sel_vendor: ["a", "b", "c", "d"].map((id) => ({ id: `hle_${id}`, kind: "TRANSFER leg", status: "PENDING" })) },
    })
    expect(many).toContain("(TRANSFER leg hle_a PENDING, TRANSFER leg hle_b PENDING, TRANSFER leg hle_c PENDING, …), so whether")
  })

  it("lists an order that already has a commission credit in the ledger, as commission already taken for it when the entry moved money off the vendor's earnings", () => {
    const rows = [row()]
    const entry = (over: Partial<NonNullable<VendorDebitContext["order_commission_entries"]>[number]> = {}) => ({
      id: "hle_cc",
      attribution_id: "oatt_1",
      status: "COMPLETED",
      amount: 0.02,
      moved: true,
      from_vendor_id: "sel_vendor",
      ...over,
    })
    const handedBack =
      "and the row is still held with no ledger entry recorded on it, so approve-held would be handed that entry back, " +
      "move nothing more, and approve the row at whatever its column then says"
    const closing =
      ". Correcting would raise what the approve-held job debits from sel_vendor's current earnings for this order from 2 to 250 once commission " +
      "crediting works. Operator decision, not changed here"

    // The credit landed, the row update did not.
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_commission_entries: [entry()] })).toBe(
      "commission was already taken from vendor sel_vendor for this order: ledger entry hle_cc (0.02 COMPLETED) " +
        `is under the key approve-held credits row oatt_1 with, ${handedBack}${closing}`
    )
    // An entry that did not move money, or moved it off an account that is
    // not an attributed vendor's, is not called commission taken; it lists
    // the order all the same, because approve-held is handed it back.
    for (const [over, shown] of [
      [{ status: "PENDING", moved: false }, "hle_cc (0.02 PENDING)"],
      [{ status: "FAILED", moved: false }, "hle_cc (0.02 FAILED)"],
      [{ from_vendor_id: null, amount: 20 }, "hle_cc (20 COMPLETED)"],
      [{ amount: Number.NaN }, null],
    ] as Array<[Parameters<typeof entry>[0], string | null]>) {
      const reason = reviewVendorDebit(planFor(rows), rows, { ...clean, order_commission_entries: [entry(over)] })
      if (shown === null) {
        expect(reason).toContain("ledger entry hle_cc (an unreadable amount COMPLETED)")
        continue
      }
      expect(reason).toBe(
        `a commission credit for this order is already in the ledger: ledger entry ${shown} ` +
          `is under the key approve-held credits row oatt_1 with, ${handedBack}${closing}`
      )
    }

    // A pending row is one approve-held will credit too, once it is held.
    const pending = [row({ commission_status: CommissionStatus.PENDING })]
    expect(reviewVendorDebit(planFor(pending), pending, { ...clean, order_commission_entries: [entry()] })).toContain(
      "and the row is still pending with no ledger entry recorded on it, so approve-held would be handed that entry back"
    )

    // Two levels, the entry under the second row's key, which approve-held
    // will not credit (reversed): the order is listed for the first row's
    // sake, and the line does not say the job would approve the second.
    const chain = [
      row({ id: "a", level: 1 }),
      row({ id: "b", level: 2, level_split_percent: 20, commission_amount_cents: 0, commission_status: CommissionStatus.REVERSED }),
    ]
    const second = reviewVendorDebit(planFor(chain), chain, { ...clean, order_commission_entries: [entry({ attribution_id: "b" })] })
    expect(second).toContain(
      "ledger entry hle_cc (0.02 COMPLETED) is under the key approve-held credits row b with, " +
        "and the row is reversed with no ledger entry recorded on it. Correcting would raise"
    )
    expect(second).not.toContain("handed that entry back")
    // An entry for a row that is not among the order's rows is listed too.
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_commission_entries: [entry({ attribution_id: "oatt_9" })] })).toContain(
      "is under the key approve-held credits row oatt_9 with, and the row is not among the rows read with no ledger entry recorded on it"
    )

    // The entries could not be read; a context built with none is read the same way.
    const unknown =
      "whether a commission credit for this order is already in the ledger could not be read, " +
      "so it cannot be shown that approve-held would move the corrected figure"
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_commission_entries: null })).toContain(unknown)
    const { order_commission_entries: _none, ...withoutEntries } = clean
    expect(reviewVendorDebit(planFor(rows), rows, withoutEntries as VendorDebitContext)).toContain(unknown)
  })

  it("lists an order placed inside the payout window that Mercur has not paid yet; one exactly at the window's end passes", () => {
    const rows = [row()]
    const recent = "inside the 48 hours in which the nightly payout sends an order's proceeds to its vendor"
    expect(PAYOUT_WINDOW_MS).toBe(2 * 24 * 60 * 60 * 1000)
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(60 * 60 * 1000) })).toContain(
      `the order was placed 1 hour before this check, ${recent}, and no payout for it exists yet`
    )
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(2 * 60 * 60 * 1000) })).toContain(
      "the order was placed 2 hours before this check"
    )
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(PAYOUT_WINDOW_MS - 1) })).toContain(recent)
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(PAYOUT_WINDOW_MS) })).toBeNull()
    // A check time before the placement, or one that cannot be read, lists it too.
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: after(-1000) })).toContain(recent)
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, checked_at: "not a date" })).toContain("an unknown time")
  })

  it("counts the payout window from when the order settled to the vendor when that is later than its placement", () => {
    const rows = [row()]
    const recent = "inside the 48 hours in which the nightly payout sends an order's proceeds to its vendor, and no payout for it exists yet"
    // Placed five days before its payment was captured; settled at capture.
    const lateCapture = { ...clean, order_settled_at: { sel_vendor: after(5 * DAY) } }

    // Checked 25 ms after it settled: five days after placement, and the
    // nightly payout will send it tonight.
    expect(reviewVendorDebit(planFor(rows), rows, { ...lateCapture, checked_at: after(5 * DAY + 25) })).toContain(
      `the order's proceeds reached the vendor's earnings 0 hours before this check (the order was placed 120 hours before it), ${recent}`
    )
    expect(reviewVendorDebit(planFor(rows), rows, { ...lateCapture, checked_at: after(5 * DAY + PAYOUT_WINDOW_MS - 1) })).toContain(
      "the order's proceeds reached the vendor's earnings 47 hours before this check (the order was placed 167 hours before it)"
    )
    expect(reviewVendorDebit(planFor(rows), rows, { ...lateCapture, checked_at: after(5 * DAY + PAYOUT_WINDOW_MS) })).toBeNull()

    // A settlement stamped before the placement does not shorten the window.
    const early = { ...clean, order_settled_at: { sel_vendor: after(-DAY) } }
    expect(reviewVendorDebit(planFor(rows), rows, { ...early, checked_at: after(PAYOUT_WINDOW_MS - 1) })).toContain(
      "the order was placed 47 hours before this check"
    )
    expect(reviewVendorDebit(planFor(rows), rows, { ...early, checked_at: after(PAYOUT_WINDOW_MS) })).toBeNull()

    // Settled, but when is missing or unreadable: it cannot be shown to be
    // outside the window, however old the order.
    const unreadable: Array<Record<string, string | null>> = [{}, { sel_vendor: null }, { sel_vendor: "not a date" }]
    for (const order_settled_at of unreadable) {
      expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_settled_at })).toContain(
        "the order's proceeds reached the vendor's earnings an unknown time before this check (the order was placed 720 hours before it)"
      )
    }

    // A vendor the order never settled to has no settlement time to count from.
    const unsettled = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      order_settled_to_vendor: { sel_vendor: false },
      order_settled_at: { sel_vendor: after(30 * DAY - 1000) },
    })
    expect(unsettled).toContain("never reached")
    expect(unsettled).not.toContain("nightly payout")
  })

  it("keeps an unreadable settlement time when a later vendor's is readable", () => {
    // Two levels, two vendors: the first settled at an unknown time, the
    // second a month ago. The unknown one must still list the order.
    const rows = [
      row({ id: "a", level: 1, vendor_id: "sel_a" }),
      row({ id: "b", level: 2, vendor_id: "sel_b", level_split_percent: 20, commission_amount_cents: 0 }),
    ]
    const reason = reviewVendorDebit(planFor(rows), rows, {
      ...clean,
      order_seller_id: "sel_a",
      order_settled_to_vendor: { sel_a: true, sel_b: true },
      order_settled_at: { sel_a: null, sel_b: PLACED },
      vendor_withdrawals: {},
    })
    expect(reason).toContain("the order's proceeds reached the vendor's earnings an unknown time before this check")
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
      order_settled_at: {},
      order_refunds: [{ id: "hle_r1", status: "COMPLETED", amount: 19.4, from_vendor_id: "sel_vendor" }],
      // Refunded and disputed by the payment records, or not readable at all.
      order_payment: { ...paidByCard, refunded: 20, unattributed_refund: 5, dispute_open: 25 },
      // A collection the records were not read from.
      order_payment_collection_ids: ["pay_col_1", "pay_col_2"],
      vendor_withdrawals: { sel_vendor: [{ id: "pr_1", kind: "payout request", status: "COMPLETED" }] },
      vendor_other_debits: { sel_vendor: [{ id: "hle_pool", kind: "TRANSFER leg for CREATOR_REWARD_POOL", status: "COMPLETED" }] },
      vendor_unconfirmed_debits: { sel_vendor: [{ id: "hle_w", kind: "withdrawal", status: "PENDING" }] },
      order_commission_entries: [
        { id: "hle_cc", attribution_id: "oatt_1", status: "COMPLETED", amount: 0.02, moved: true, from_vendor_id: "sel_vendor" },
      ],
    }
    for (const rows of [
      [row({ commission_status: CommissionStatus.REVERSED })],
      [row({ commission_status: CommissionStatus.DISQUALIFIED })],
      [row({ vendor_id: null })],
    ]) {
      expect(vendorsDebitedOnApproval(rows)).toEqual([])
      expect(reviewVendorDebit(planFor(rows), rows, paidOut)).toBeNull()
      expect(reviewVendorDebit(planFor(rows), rows, { ...paidOut, order_payment: null })).toBeNull()
      expect(reviewVendorDebit(planFor(rows), rows, { ...paidOut, order_payment_collection_ids: null })).toBeNull()
      expect(reviewVendorDebit(planFor(rows), rows, { ...paidOut, order_commission_entries: null })).toBeNull()
    }
  })

  it("counts a pending row as one approve-held will credit", () => {
    const rows = [row({ commission_status: CommissionStatus.PENDING })]
    expect(vendorsDebitedOnApproval(rows)).toEqual(["sel_vendor"])
    expect(reviewVendorDebit(planFor(rows), rows, { ...clean, order_seller_id: "sel_other" })).not.toBeNull()
  })
})
