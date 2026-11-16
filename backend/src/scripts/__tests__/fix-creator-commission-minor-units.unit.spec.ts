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
 * correcting an order whose correction would raise a vendor debit nobody
 * decided on (vendor paid out since, vendor not the seller). Its decisions are tested in
 * `modules/creator-attribution/__tests__/minor-unit-correction.unit.spec.ts`;
 * the same run on Postgres in `integration-tests/http/creator-commission-minor-units.spec.ts`.
 *
 * The container resolves only the keys the script imports and throws on
 * anything else, so a guessed key fails here instead of reaching a default.
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

function makeContainer(
  opts: {
    written?: { written: true } | { written: false; stale_id: string }
    seller?: string | null
    payoutRequests?: Array<{ id: string; status: string }>
    withdrawals?: Array<{ id: string; status: string }>
    orderPayouts?: Array<{ id: string }>
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
  const listLedgerEntries = jest.fn(async (_filters: Record<string, unknown>, _config?: unknown) => opts.withdrawals ?? [])
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
    expect(logger.warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "raises what the approve-held job will debit from each vendor's current SELLER_EARNINGS to the full commission"
    )
  })

  it("with apply, writes the order's rows in one conditional call: planned status and figures, minor-unit figures, a record", async () => {
    const { container, correctAttributionAmountsIfUnchanged } = makeContainer()
    const summary = await fixCreatorCommissionMinorUnits(container, { apply: true })
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
    const summary = await fixCreatorCommissionMinorUnits(container, { apply: true })
    expect(summary.corrected).toEqual([])
    expect(summary.review).toEqual([
      { order_id: "order_1", reason: expect.stringContaining("row oatt_1 changed since it was read (planned from held)") },
    ])
  })

  it("looks for the vendor's payouts since the order was placed, and lists the order when there are any", async () => {
    const { container, correctAttributionAmountsIfUnchanged, listPayoutRequests, listLedgerEntries } = makeContainer({
      payoutRequests: [{ id: "pr_1", status: "COMPLETED" }],
      withdrawals: [{ id: "hle_w1", status: "COMPLETED" }],
    })
    const summary = await fixCreatorCommissionMinorUnits(container, { apply: true })
    expect(correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(summary.corrected).toEqual([])
    expect(summary.review).toEqual([{ order_id: "order_1", reason: expect.stringContaining("payout request pr_1 COMPLETED") }])
    expect(summary.review[0].reason).toContain("withdrawal hle_w1 COMPLETED")
    const placed = new Date("2026-10-01T12:00:00.000Z")
    expect(listPayoutRequests).toHaveBeenCalledWith(
      { vendor_id: "sel_vendor", status: ["PROCESSING", "IN_TRANSIT", "COMPLETED"], created_at: { $gte: placed } },
      expect.anything()
    )
    expect(listLedgerEntries).toHaveBeenCalledWith(
      { debit_account_id: ["hla_vendor"], entry_type: "WITHDRAWAL", status: "COMPLETED", created_at: { $gte: placed } },
      expect.anything()
    )
  })

  it("lists an order whose seller is not the attributed vendor, or whose proceeds Mercur paid out", async () => {
    for (const opts of [{ seller: "sel_other" }, { seller: null }, { orderPayouts: [{ id: "pout_1" }] }]) {
      const { container, correctAttributionAmountsIfUnchanged } = makeContainer(opts)
      const summary = await fixCreatorCommissionMinorUnits(container, { apply: true })
      expect(correctAttributionAmountsIfUnchanged).not.toHaveBeenCalled()
      expect(summary.review.map((r) => r.order_id)).toEqual(["order_1"])
    }
  })
})
