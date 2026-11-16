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
 * the vendor, vendor paid out since, order too recent). Its decisions are tested in
 * `modules/creator-attribution/__tests__/minor-unit-correction.unit.spec.ts`;
 * the same run on Postgres in `integration-tests/http/creator-commission-minor-units.spec.ts`.
 *
 * The container resolves only the keys the script imports and throws on
 * anything else, so a guessed key fails here instead of reaching a default.
 * The ledger stub answers like the table would: a settlement-leg read gets
 * only the legs whose key and status it asked for, so asking with the wrong
 * keys or statuses finds nothing and the order is listed.
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
type SettlementLeg = { id: string; idempotency_key: string; status: string; credit_account_id: string }

/** The order's settlement as the card path writes it: one completed leg to the vendor's earnings. */
const settledToVendor: SettlementLeg = {
  id: "hle_settle",
  idempotency_key: "order-payment-order_1-seller",
  status: "COMPLETED",
  credit_account_id: "hla_vendor",
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
    if (!("idempotency_key" in filters)) return opts.withdrawals ?? []
    const keys = filters.idempotency_key as string[]
    const statuses = filters.status as string[]
    return (opts.settlementLegs ?? [settledToVendor]).filter(
      (leg) => keys.includes(leg.idempotency_key) && statuses.includes(leg.status)
    )
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
    expect(warned).toContain("a vendor paid out after this run is still debited the full commission")
    expect(warned).toContain("immediately before the repair that makes commission crediting work deploys, not earlier")
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
      // A settlement that failed, or was reversed, moved nothing to the vendor.
      [leg({ status: "FAILED" })],
      [leg({ status: "REVERSED" })],
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
    }

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
      expect(listLedgerEntries).toHaveBeenCalledWith({
        idempotency_key: ["order-payment-order_1-seller", "order-payment-order_1-vendor", "order-payment-order_1-consignor"],
        status: ["COMPLETED", "SETTLED"],
      })
      expect(listLedgerAccounts).toHaveBeenCalledWith({ owner_id: "sel_vendor", account_type: "SELLER_EARNINGS" })
    }
  })

  it("lists an order placed in the last 2 days, measured from when it runs; corrects it once the payout window has passed", async () => {
    // The order was placed 2026-10-01T12:00Z.
    const recent = makeContainer()
    const early = await fixCreatorCommissionMinorUnits(recent.container, { apply: true, now: new Date("2026-10-03T11:59:59.000Z") })
    expect(recent.correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(early.corrected).toEqual([])
    expect(early.review).toEqual([
      { order_id: "order_1", reason: expect.stringContaining("the order was placed 47 hours before this check, inside the 48 hours") },
    ])

    const aged = makeContainer()
    const late = await fixCreatorCommissionMinorUnits(aged.container, { apply: true, now: new Date("2026-10-03T12:00:00.000Z") })
    expect(late.review).toEqual([])
    expect(late.corrected.map((c) => c.order_id)).toEqual(["order_1"])
  })
})
