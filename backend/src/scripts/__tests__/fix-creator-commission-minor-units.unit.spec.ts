import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import run, { fixCreatorCommissionMinorUnits } from "../fix-creator-commission-minor-units"
import { CREATOR_ATTRIBUTION_MODULE } from "../../modules/creator-attribution"
import { CommissionStatus } from "../../modules/creator-attribution/models/order-attribution"

/**
 * SD-95's corrective script: refuses any word it does not know, writes only
 * when told `apply`, and writes a row only while it still has the status the
 * correction was planned from. Its decisions are tested in
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
  metadata: null,
}

function makeContainer(opts: { updated?: unknown[] } = {}) {
  const listOrderAttributions = jest.fn(async (filters: Record<string, unknown>, config?: { skip?: number }) => {
    if ("level" in filters) return (config?.skip ?? 0) === 0 ? [legacy] : []
    return [legacy]
  })
  const updateOrderAttributions = jest.fn(async (_input: unknown) => opts.updated ?? [{ id: "oatt_1" }])
  const graph = jest.fn(async () => ({ data: [{ id: "order_1", subtotal: 25, total: 25, currency_code: "usd" }] }))
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const registry: Record<string, unknown> = {
    [CREATOR_ATTRIBUTION_MODULE]: { listOrderAttributions, updateOrderAttributions },
    [ContainerRegistrationKeys.QUERY]: { graph },
    [ContainerRegistrationKeys.LOGGER]: logger,
  }
  const container = {
    resolve: (key: string) => {
      if (!(key in registry)) throw new Error(`unresolvable: ${key}`)
      return registry[key]
    },
  } as unknown as MedusaContainer
  return { container, listOrderAttributions, updateOrderAttributions, logger }
}

describe("fix-creator-commission-minor-units", () => {
  it.each([["--apply"], ["dryrun"], ["apply", "dry-run"]])("refuses %p before reading anything", async (...args) => {
    const { container, listOrderAttributions } = makeContainer()
    await expect(run({ container, args } as unknown as ExecArgs)).rejects.toThrow(/refused/)
    expect(listOrderAttributions).not.toHaveBeenCalled()
  })

  it("is a dry run with no word: plans the correction, writes nothing", async () => {
    const { container, updateOrderAttributions, logger } = makeContainer()
    await run({ container, args: [] } as unknown as ExecArgs)
    expect(updateOrderAttributions).not.toHaveBeenCalled()
    expect(logger.info.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "would correct order order_1: subtotal 25 → 2500, commission 2 → 250"
    )
  })

  it("with apply, writes the minor-unit figures conditional on the planned status, with a record", async () => {
    const { container, updateOrderAttributions } = makeContainer()
    const summary = await fixCreatorCommissionMinorUnits(container, { apply: true })
    expect(summary.corrected.map((c) => c.order_id)).toEqual(["order_1"])
    expect(updateOrderAttributions).toHaveBeenCalledWith({
      selector: { id: "oatt_1", commission_status: CommissionStatus.HELD },
      data: expect.objectContaining({
        attributed_subtotal_cents: 2500,
        commission_basis_cents: 2500,
        commission_amount_cents: 250,
        metadata: {
          amount_units_corrected: expect.objectContaining({
            by: "script:fix-creator-commission-minor-units",
            commission_amount_cents: { from: 2, to: 250 },
          }),
        },
      }),
    })
  })

  it("lists a row whose status changed since it was read (approve-held ran in between) instead of claiming it", async () => {
    const { container } = makeContainer({ updated: [] })
    const summary = await fixCreatorCommissionMinorUnits(container, { apply: true })
    expect(summary.corrected).toEqual([])
    expect(summary.review).toEqual([{ order_id: "order_1", reason: expect.stringContaining("changed status") }])
  })
})
