import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import run, { fixCreatorCommissionMinorUnits } from "../fix-creator-commission-minor-units"
import { CREATOR_ATTRIBUTION_MODULE } from "../../modules/creator-attribution"
import { CommissionStatus } from "../../modules/creator-attribution/models/order-attribution"
import { HAWALA_LEDGER_MODULE } from "../../modules/hawala-ledger"

/**
 * SD-95's corrective script: refuses any word it does not know, writes only
 * when told `apply`, writes an order's rows only while they still have the
 * status and figures the correction was planned from, and lists instead of
 * correcting an order where what it reads argues against the vendor debit
 * the correction sets up (vendor not the seller, proceeds never settled to
 * the vendor or reversed by a refund, order refunded, vendor paid out since,
 * order placed or settled too recently). Its decisions are tested in
 * `modules/creator-attribution/__tests__/minor-unit-correction.unit.spec.ts`;
 * the same run on Postgres in `integration-tests/http/creator-commission-minor-units.spec.ts`.
 *
 * The container resolves only the keys the script imports and throws on
 * anything else, so a guessed key fails here instead of reaching a default.
 * The ledger stub answers like the table would: a settlement-leg read gets
 * only the legs whose key and status it asked for, and a refund-leg read only
 * the order's REFUND legs in the statuses it asked for, so asking with the
 * wrong keys, order or statuses finds nothing.
 */

const legacy = {
  id: "oatt_1",
  order_id: "order_1",
  level: 1,
  commission_status: CommissionStatus.HELD,
  ledger_entry_id: null,
  attributed_subtotal_cents: "25",
  commission_basis_cents: "25",
  commission_amount_cents: "2",
  commission_percent: "10",
  level_split_percent: "80",
  currency_code: "usd",
  vendor_id: "sel_vendor",
  created_at: "2026-10-01T12:00:00.000Z",
  metadata: null,
}

type Graph = { entity: string; fields: string[]; filters: { id: string } }
type SettlementLeg = {
  id: string
  idempotency_key: string
  status: string
  credit_account_id: string
  created_at?: string | Date | null
}
type RefundLeg = { id: string; order_id: string; status: string; amount: number; debit_account_id: string }

/**
 * The order's settlement as the card path writes it for a payment captured
 * at placement: one completed leg to the vendor's earnings, seconds after
 * the order.
 */
const settledToVendor: SettlementLeg = {
  id: "hle_settle",
  idempotency_key: "order-payment-order_1-seller",
  status: "COMPLETED",
  credit_account_id: "hla_vendor",
  created_at: "2026-10-01T12:00:05.000Z",
}

/** A month after the order: nothing about its age stands in the way. */
const LATER = new Date("2026-11-01T12:00:00.000Z")

function makeContainer(
  opts: {
    written?: { written: true } | { written: false; stale_id: string }
    seller?: string | null
    payoutRequests?: Array<{ id: string; status: string }>
    withdrawals?: Array<{ id: string; status: string; entry_type?: string }>
    orderPayouts?: Array<{ id: string }>
    /** Every ledger entry carrying a key of this order, whatever its status. Default: settled to the vendor. */
    settlementLegs?: SettlementLeg[]
    /** Every REFUND entry in the ledger, whatever its order or status. Default: none. */
    refundLegs?: RefundLeg[]
  } = {}
) {
  const listOrderAttributions = jest.fn(async (filters: Record<string, unknown>, config?: { skip?: number }) => {
    if ("level" in filters) return (config?.skip ?? 0) === 0 ? [legacy] : []
    return [legacy]
  })
  const correctAttributionAmountsIfUnchanged = jest.fn(async (_rows: unknown) => opts.written ?? { written: true })
  const graph = jest.fn(async (input: Graph) =>
    input.fields.includes("seller.id")
      ? {
          data: [
            {
              id: "order_1",
              created_at: "2026-10-01T12:00:00.000Z",
              seller: opts.seller === null ? null : { id: opts.seller ?? "sel_vendor" },
              payouts: opts.orderPayouts ?? [],
            },
          ],
        }
      : { data: [{ id: "order_1", subtotal: 25, total: 25, currency_code: "usd" }] }
  )
  const listPayoutRequests = jest.fn(async (_filters: Record<string, unknown>, _config?: unknown) => opts.payoutRequests ?? [])
  const listLedgerAccounts = jest.fn(async (_filters: Record<string, unknown>) => [{ id: "hla_vendor" }])
  const listLedgerEntries = jest.fn(async (filters: Record<string, unknown>, _config?: unknown) => {
    const statuses = filters.status as string[]
    if ("idempotency_key" in filters) {
      const keys = filters.idempotency_key as string[]
      return (opts.settlementLegs ?? [settledToVendor]).filter(
        (leg) => keys.includes(leg.idempotency_key) && statuses.includes(leg.status)
      )
    }
    if (filters.entry_type === "REFUND") {
      return (opts.refundLegs ?? []).filter((leg) => leg.order_id === filters.order_id && statuses.includes(leg.status))
    }
    return opts.withdrawals ?? []
  })
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const registry: Record<string, unknown> = {
    [CREATOR_ATTRIBUTION_MODULE]: { listOrderAttributions, correctAttributionAmountsIfUnchanged },
    [HAWALA_LEDGER_MODULE]: { listPayoutRequests, listLedgerAccounts, listLedgerEntries },
    [ContainerRegistrationKeys.QUERY]: { graph },
    [ContainerRegistrationKeys.LOGGER]: logger,
  }
  const container = {
    resolve: (key: string) => {
      if (!(key in registry)) throw new Error(`unresolvable: ${key}`)
      return registry[key]
    },
  } as unknown as MedusaContainer
  return {
    container,
    listOrderAttributions,
    correctAttributionAmountsIfUnchanged,
    listPayoutRequests,
    listLedgerAccounts,
    listLedgerEntries,
    logger,
  }
}

describe("fix-creator-commission-minor-units", () => {
  it.each([["--apply"], ["dryrun"], ["apply", "dry-run"]])("refuses %p before reading anything", async (...args) => {
    const { container, listOrderAttributions } = makeContainer()
    await expect(run({ container, args } as unknown as ExecArgs)).rejects.toThrow(/refused/)
    expect(listOrderAttributions).not.toHaveBeenCalled()
  })

  it("is a dry run with no word: plans the correction, says what it sets up, writes nothing", async () => {
    const { container, correctAttributionAmountsIfUnchanged, logger } = makeContainer()
    await run({ container, args: [] } as unknown as ExecArgs)
    expect(correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(logger.info.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "would correct order order_1: subtotal 25 → 2500, commission 2 → 250"
    )
    const warned = logger.warn.mock.calls.map((c) => String(c[0])).join("\n")
    expect(warned).toContain(
      "raises what the approve-held job will debit from each vendor's current SELLER_EARNINGS to the full commission"
    )
    // What the checks do not cover, and when to run it, said every time something would be corrected.
    expect(warned).toContain("Those checks were made once, just now")
    expect(warned).toContain("a vendor paid out after this run, or whose order is refunded after it, is still debited the full commission")
    expect(warned).toContain("immediately before the repair that makes commission crediting work deploys, not earlier")
    expect(warned).toContain("or which were placed or settled in the last 2 days are listed for review instead")
    // Nothing was listed for never settling, so the flag is not brought up.
    expect(warned).not.toContain("FF_CARD_ORDER_LEDGER_V1")
  })

  it("with apply, writes the order's rows in one conditional call: planned status and figures, minor-unit figures, a record", async () => {
    const { container, correctAttributionAmountsIfUnchanged } = makeContainer()
    const summary = await fixCreatorCommissionMinorUnits(container, { apply: true, now: LATER })
    expect(summary.corrected.map((c) => c.order_id)).toEqual(["order_1"])
    expect(correctAttributionAmountsIfUnchanged).toHaveBeenCalledTimes(1)
    expect(correctAttributionAmountsIfUnchanged).toHaveBeenCalledWith([
      {
        id: "oatt_1",
        status: CommissionStatus.HELD,
        from: { subtotal_cents: 25, commission_cents: 2 },
        to: { subtotal_cents: 2500, commission_cents: 250 },
        record: expect.objectContaining({
          by: "script:fix-creator-commission-minor-units",
          commission_amount_cents: { from: 2, to: 250 },
        }),
      },
    ])
  })

  it("lists an order a row of which changed since it was read (approve-held ran in between) instead of claiming it", async () => {
    const { container } = makeContainer({ written: { written: false, stale_id: "oatt_1" } })
    const summary = await fixCreatorCommissionMinorUnits(container, { apply: true, now: LATER })
    expect(summary.corrected).toEqual([])
    expect(summary.review).toEqual([
      { order_id: "order_1", reason: expect.stringContaining("row oatt_1 changed since it was read (planned from held)") },
    ])
  })

  it("looks for the vendor's payouts since the order was placed, and lists the order when there are any", async () => {
    const { container, correctAttributionAmountsIfUnchanged, listPayoutRequests, listLedgerEntries } = makeContainer({
      payoutRequests: [{ id: "pr_1", status: "COMPLETED" }],
      withdrawals: [
        { id: "hle_w1", status: "COMPLETED", entry_type: "WITHDRAWAL" },
        { id: "hle_vp1", status: "COMPLETED", entry_type: "VENDOR_PAYMENT" },
      ],
    })
    const summary = await fixCreatorCommissionMinorUnits(container, { apply: true, now: LATER })
    expect(correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(summary.corrected).toEqual([])
    expect(summary.review).toEqual([{ order_id: "order_1", reason: expect.stringContaining("payout request pr_1 COMPLETED") }])
    expect(summary.review[0].reason).toContain("withdrawal hle_w1 COMPLETED")
    expect(summary.review[0].reason).toContain("vendor payment hle_vp1 COMPLETED")
    const placed = new Date("2026-10-01T12:00:00.000Z")
    expect(listPayoutRequests).toHaveBeenCalledWith(
      { vendor_id: "sel_vendor", status: ["PROCESSING", "IN_TRANSIT", "COMPLETED"], created_at: { $gte: placed } },
      expect.anything()
    )
    expect(listLedgerEntries).toHaveBeenCalledWith(
      {
        debit_account_id: ["hla_vendor"],
        entry_type: ["WITHDRAWAL", "VENDOR_PAYMENT"],
        // SETTLED too: the settlement batch re-labels a completed leg once it is anchored.
        status: ["COMPLETED", "SETTLED"],
        created_at: { $gte: placed },
      },
      expect.anything()
    )
  })

  it("lists an order whose seller is not the attributed vendor, or whose proceeds Mercur paid out", async () => {
    for (const opts of [{ seller: "sel_other" }, { seller: null }, { orderPayouts: [{ id: "pout_1" }] }]) {
      const { container, correctAttributionAmountsIfUnchanged } = makeContainer(opts)
      const summary = await fixCreatorCommissionMinorUnits(container, { apply: true, now: LATER })
      expect(correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
      expect(summary.review.map((r) => r.order_id)).toEqual(["order_1"])
    }
  })

  it("reads the order's settlement legs by their keys, in the statuses that moved money, and corrects only when one credits the vendor's earnings", async () => {
    const never = "the order's proceeds never reached vendor sel_vendor's earnings in the ledger"
    const leg = (over: Partial<SettlementLeg>): SettlementLeg => ({ ...settledToVendor, ...over })

    for (const settlementLegs of [
      // Never settled: flag-off settlement throws, a connected-account charge returns early.
      [],
      // A settlement that failed, or has not posted, moved nothing to the vendor.
      [leg({ status: "FAILED" })],
      [leg({ status: "PENDING" })],
      // The consignor took the whole seller side; nothing credited the vendor.
      [leg({ idempotency_key: "order-payment-order_1-consignor", credit_account_id: "hla_consignor" })],
      // Other legs of the same order are not its proceeds reaching the vendor.
      [leg({ idempotency_key: "order-payment-order_1-fee" }), leg({ idempotency_key: "order-payment-order_1-purchase" })],
      // Another order's seller leg.
      [leg({ idempotency_key: "order-payment-order_10-seller" })],
    ]) {
      const { container, correctAttributionAmountsIfUnchanged } = makeContainer({ settlementLegs })
      const summary = await fixCreatorCommissionMinorUnits(container, { apply: true, now: LATER })
      expect(correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
      expect(summary.corrected).toEqual([])
      expect(summary.review).toEqual([{ order_id: "order_1", reason: expect.stringContaining(never) }])
      expect(summary.never_settled).toEqual(["order_1"])
    }

    // A leg a refund reversed (the order refunded in full): listed, and the
    // line says the proceeds arrived and were taken back, not that they
    // never arrived. It is not counted with the orders that never settled.
    const reversed = makeContainer({ settlementLegs: [leg({ status: "REVERSED" })] })
    const refundedInFull = await fixCreatorCommissionMinorUnits(reversed.container, { apply: true, now: LATER })
    expect(reversed.correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(refundedInFull.review).toEqual([
      {
        order_id: "order_1",
        reason: expect.stringContaining("reached vendor sel_vendor's earnings in the ledger and a refund reversed them"),
      },
    ])
    expect(refundedInFull.review[0].reason).not.toContain("never reached")
    expect(refundedInFull.never_settled).toEqual([])

    for (const settlementLegs of [
      [settledToVendor],
      [leg({ status: "SETTLED" })],
      [
        leg({ idempotency_key: "order-payment-order_1-consignor", credit_account_id: "hla_consignor" }),
        leg({ idempotency_key: "order-payment-order_1-vendor" }),
      ],
    ]) {
      const { container, listLedgerEntries, listLedgerAccounts } = makeContainer({ settlementLegs })
      const summary = await fixCreatorCommissionMinorUnits(container, { apply: true, now: LATER })
      expect(summary.review).toEqual([])
      expect(summary.corrected.map((c) => c.order_id)).toEqual(["order_1"])
      expect(summary.never_settled).toEqual([])
      expect(listLedgerEntries).toHaveBeenCalledWith({
        idempotency_key: ["order-payment-order_1-seller", "order-payment-order_1-vendor", "order-payment-order_1-consignor"],
        // REVERSED is asked for only to word the review line; it never counts as settled.
        status: ["COMPLETED", "SETTLED", "REVERSED"],
      })
      expect(listLedgerAccounts).toHaveBeenCalledWith({ owner_id: "sel_vendor", account_type: "SELLER_EARNINGS" })
    }
  })

  it("says once, in the log, that orders never settle to the ledger with FF_CARD_ORDER_LEDGER_V1 off, when orders are listed for that", async () => {
    const { container, logger } = makeContainer({ settlementLegs: [] })
    await run({ container, args: [] } as unknown as ExecArgs)
    const warned = logger.warn.mock.calls.map((c) => String(c[0]))
    const summaryLines = warned.filter((line) => line.includes("FF_CARD_ORDER_LEDGER_V1"))
    expect(summaryLines).toHaveLength(1)
    expect(summaryLines[0]).toContain(
      "1 of the 1 orders listed for review have proceeds that never reached the attributed vendor's earnings in the ledger"
    )
    expect(summaryLines[0]).toContain(
      "With FF_CARD_ORDER_LEDGER_V1 off (the default) no order settles to the ledger, " +
        "so that is every held or pending row that names a vendor, and none of them is corrected"
    )
    // Nothing would be corrected, so the two warnings about corrected rows are not printed.
    expect(warned.join("\n")).not.toContain("Those checks were made once")
  })

  it("counts the payout window from the settlement leg that credited the vendor when the payment was captured after the order was placed", async () => {
    // Placed 2026-10-01T12:00Z; its payment captured, and the order settled, five days later.
    const lateLeg: SettlementLeg = { ...settledToVendor, created_at: "2026-10-06T12:00:00.000Z" }
    const settledWording = "the order's proceeds reached the vendor's earnings"

    const justSettled = makeContainer({ settlementLegs: [lateLeg] })
    const atCapture = await fixCreatorCommissionMinorUnits(justSettled.container, { apply: true, now: new Date("2026-10-06T12:00:00.025Z") })
    expect(justSettled.correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(atCapture.corrected).toEqual([])
    expect(atCapture.review).toEqual([
      {
        order_id: "order_1",
        reason: expect.stringContaining(
          `${settledWording} 0 hours before this check (the order was placed 120 hours before it), inside the 48 hours`
        ),
      },
    ])
    // Listed for its settlement's age, not for never settling.
    expect(atCapture.never_settled).toEqual([])

    const stillInside = makeContainer({ settlementLegs: [lateLeg] })
    const almost = await fixCreatorCommissionMinorUnits(stillInside.container, { apply: true, now: new Date("2026-10-08T11:59:59.999Z") })
    expect(almost.review).toEqual([{ order_id: "order_1", reason: expect.stringContaining(`${settledWording} 47 hours before this check`) }])

    const past = makeContainer({ settlementLegs: [lateLeg] })
    const after = await fixCreatorCommissionMinorUnits(past.container, { apply: true, now: new Date("2026-10-08T12:00:00.000Z") })
    expect(after.review).toEqual([])
    expect(after.corrected.map((c) => c.order_id)).toEqual(["order_1"])

    // The latest of the legs that credited the vendor counts; a later leg to
    // someone else (the consignor's share) does not, nor does a reversed one.
    const mixed = makeContainer({
      settlementLegs: [
        { ...settledToVendor, id: "hle_vendor", idempotency_key: "order-payment-order_1-vendor", created_at: new Date("2026-10-06T12:00:00.000Z") },
        { ...settledToVendor, id: "hle_consignor", idempotency_key: "order-payment-order_1-consignor", credit_account_id: "hla_consignor", created_at: "2026-10-20T12:00:00.000Z" },
        { ...settledToVendor, id: "hle_old", status: "REVERSED", created_at: "2026-10-21T12:00:00.000Z" },
      ],
    })
    const mixedRun = await fixCreatorCommissionMinorUnits(mixed.container, { apply: true, now: new Date("2026-10-08T12:00:00.000Z") })
    expect(mixedRun.review).toEqual([])
    expect(mixedRun.corrected.map((c) => c.order_id)).toEqual(["order_1"])
    const twoLegs = makeContainer({
      settlementLegs: [
        settledToVendor,
        { ...settledToVendor, id: "hle_vendor", idempotency_key: "order-payment-order_1-vendor", created_at: "2026-10-06T12:00:00.000Z" },
      ],
    })
    const twoLegsRun = await fixCreatorCommissionMinorUnits(twoLegs.container, { apply: true, now: new Date("2026-10-08T11:00:00.000Z") })
    expect(twoLegsRun.review).toEqual([{ order_id: "order_1", reason: expect.stringContaining(`${settledWording} 47 hours before this check`) }])

    // A leg with no readable time: the order cannot be shown to be outside the window.
    for (const created_at of [null, undefined, "not a date"]) {
      const undated = makeContainer({ settlementLegs: [{ ...settledToVendor, created_at }] })
      const run = await fixCreatorCommissionMinorUnits(undated.container, { apply: true, now: LATER })
      expect(undated.correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
      expect(run.review).toEqual([
        { order_id: "order_1", reason: expect.stringContaining(`${settledWording} an unknown time before this check`) },
      ])
    }
    // One undated leg among dated ones is enough: the dated one does not vouch for it.
    const partlyDated = makeContainer({
      settlementLegs: [
        { ...settledToVendor, created_at: null },
        { ...settledToVendor, id: "hle_vendor", idempotency_key: "order-payment-order_1-vendor" },
      ],
    })
    const partlyDatedRun = await fixCreatorCommissionMinorUnits(partlyDated.container, { apply: true, now: LATER })
    expect(partlyDatedRun.corrected).toEqual([])
    expect(partlyDatedRun.review[0].reason).toContain(`${settledWording} an unknown time before this check`)
  })

  it("reads the order's refund legs that moved money and lists the order when there are any", async () => {
    const refundLeg = (over: Partial<RefundLeg> = {}): RefundLeg => ({
      id: "hle_refund_seller",
      order_id: "order_1",
      status: "COMPLETED",
      amount: 19.4,
      debit_account_id: "hla_vendor",
      ...over,
    })
    const notReversed = "its attribution was not reversed (a refund does not reverse a held attribution; only a cancellation does)"

    // A card order refunded in part: its settlement leg is still COMPLETED,
    // the seller's share of the refund came out of the vendor's earnings.
    const partial = makeContainer({
      refundLegs: [refundLeg({ id: "hle_refund_fee", amount: 0.6, debit_account_id: "hla_platform" }), refundLeg(), refundLeg({ id: "hle_refund_customer", amount: 20, debit_account_id: "hla_escrow" })],
    })
    const summary = await fixCreatorCommissionMinorUnits(partial.container, { apply: true, now: LATER })
    expect(partial.correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(summary.corrected).toEqual([])
    expect(summary.review).toEqual([
      {
        order_id: "order_1",
        reason: expect.stringContaining(
          `the order was refunded out of vendor sel_vendor's earnings (refund leg hle_refund_seller 19.4 COMPLETED) and ${notReversed}`
        ),
      },
    ])
    expect(summary.never_settled).toEqual([])
    expect(partial.listLedgerEntries).toHaveBeenCalledWith({
      order_id: "order_1",
      entry_type: "REFUND",
      status: ["COMPLETED", "SETTLED"],
    })

    // Refunded with nothing taken from the vendor's earnings (they held
    // nothing; the ledger records it as owed by the vendor): listed too.
    const owed = makeContainer({
      refundLegs: [refundLeg({ id: "hle_refund_customer", amount: 20, debit_account_id: "hla_escrow", status: "SETTLED" })],
    })
    const owedRun = await fixCreatorCommissionMinorUnits(owed.container, { apply: true, now: LATER })
    expect(owed.correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(owedRun.review).toEqual([
      {
        order_id: "order_1",
        reason: expect.stringContaining(
          `the order was refunded in the ledger (refund leg hle_refund_customer 20 SETTLED) with nothing taken from sel_vendor's earnings, and ${notReversed}`
        ),
      },
    ])

    // Refund legs that moved nothing, and another order's, are not this order refunded.
    for (const refundLegs of [
      [refundLeg({ status: "FAILED" })],
      [refundLeg({ status: "PENDING" })],
      [refundLeg({ status: "REVERSED" })],
      [refundLeg({ order_id: "order_10" })],
    ]) {
      const { container } = makeContainer({ refundLegs })
      const run = await fixCreatorCommissionMinorUnits(container, { apply: true, now: LATER })
      expect(run.review).toEqual([])
      expect(run.corrected.map((c) => c.order_id)).toEqual(["order_1"])
    }
  })

  it("lists an order placed and settled in the last 2 days, measured from when it runs; corrects it once the payout window has passed", async () => {
    // The order was placed 2026-10-01T12:00:00Z and, its payment captured at
    // placement, settled to the vendor five seconds later. Two days after
    // the placement it is still one millisecond inside the window.
    const recent = makeContainer()
    const early = await fixCreatorCommissionMinorUnits(recent.container, { apply: true, now: new Date("2026-10-03T12:00:04.999Z") })
    expect(recent.correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(early.corrected).toEqual([])
    expect(early.review).toEqual([
      {
        order_id: "order_1",
        reason: expect.stringContaining(
          "the order's proceeds reached the vendor's earnings 47 hours before this check (the order was placed 48 hours before it), inside the 48 hours"
        ),
      },
    ])

    const aged = makeContainer()
    const late = await fixCreatorCommissionMinorUnits(aged.container, { apply: true, now: new Date("2026-10-03T12:00:05.000Z") })
    expect(late.review).toEqual([])
    expect(late.corrected.map((c) => c.order_id)).toEqual(["order_1"])

    // A leg stamped at the placement itself: the placement is what counts.
    const sameInstant = { ...settledToVendor, created_at: "2026-10-01T12:00:00.000Z" }
    const placedOnly = makeContainer({ settlementLegs: [sameInstant] })
    const before = await fixCreatorCommissionMinorUnits(placedOnly.container, { apply: true, now: new Date("2026-10-03T11:59:59.999Z") })
    expect(before.review).toEqual([
      { order_id: "order_1", reason: expect.stringContaining("the order was placed 47 hours before this check, inside the 48 hours") },
    ])
    const exactly = makeContainer({ settlementLegs: [sameInstant] })
    const at = await fixCreatorCommissionMinorUnits(exactly.container, { apply: true, now: new Date("2026-10-03T12:00:00.000Z") })
    expect(at.corrected.map((c) => c.order_id)).toEqual(["order_1"])
  })
})
