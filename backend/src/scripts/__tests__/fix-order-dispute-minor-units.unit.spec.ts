import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import run, { fixOrderDisputeMinorUnits } from "../fix-order-dispute-minor-units"
import { ORDER_DISPUTE_MODULE } from "../../modules/order-dispute"
import { AMOUNT_UNIT_METADATA_KEY, AMOUNT_UNIT_MINOR, DisputeStatus } from "../../modules/order-dispute/resolution"

/**
 * The corrective script refuses to run without a cutoff, asks the database
 * only for rows created before it, and never writes a row the fixed intake
 * marked as minor units. Its decisions are tested in
 * `modules/order-dispute/__tests__/minor-unit-correction.unit.spec.ts`; the
 * same paths on a real database in `integration-tests/http/admin-disputes.spec.ts`.
 *
 * The container resolves only the keys the script imports and throws on
 * anything else, so a guessed key fails here instead of reaching a default.
 */

const CUTOFF = "2026-11-10T12:00:00Z" // in the past: a future cutoff is refused

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  order_id: `order_${id}`,
  seller_id: "sel_a",
  status: DisputeStatus.OPEN,
  currency_code: "usd",
  claim_amount: 25, // floor(25.99): what the old intake stored
  award_amount: 0,
  created_at: "2026-11-01T09:00:00Z",
  metadata: null,
  ...over,
})

function makeContainer(rows: Record<string, unknown>[]) {
  const listOrderDisputes = jest.fn(async (_filters: Record<string, unknown>, config: { skip?: number }) =>
    (config.skip ?? 0) === 0 ? rows : []
  )
  const updateOrderDisputes = jest.fn(async (_input: Record<string, unknown>) => undefined)
  const createOrderDisputeEvents = jest.fn(async (_input: Record<string, unknown>[]) => undefined)
  const graph = jest.fn(async (_q: { filters: { id: string } }) => ({
    data: [
      {
        id: _q.filters.id,
        customer_id: "cus_1",
        created_at: "2026-11-01T09:00:00Z",
        currency_code: "usd",
        seller: { id: "sel_a" },
        items: [{ total: 25.99, product: { seller: { id: "sel_a" } } }],
      },
    ],
  }))
  const logger = {
    info: jest.fn((_m: string) => undefined),
    warn: jest.fn((_m: string) => undefined),
    error: jest.fn((_m: string) => undefined),
  }
  const resolved: string[] = []
  const registry: Record<string, unknown> = {
    [ORDER_DISPUTE_MODULE]: { listOrderDisputes, updateOrderDisputes, createOrderDisputeEvents },
    [ContainerRegistrationKeys.QUERY]: { graph },
    [ContainerRegistrationKeys.LOGGER]: logger,
  }
  const container = {
    resolve: (key: string) => {
      resolved.push(key)
      if (!(key in registry)) throw new Error(`unexpected container key: ${key}`)
      return registry[key]
    },
  } as unknown as MedusaContainer

  return { container, listOrderDisputes, updateOrderDisputes, createOrderDisputeEvents, logger, resolved }
}

const exec = (container: MedusaContainer, args: string[]) =>
  run({ container, args } as unknown as ExecArgs)

describe("fix-order-dispute-minor-units: the cutoff", () => {
  it("refuses to run without one, and reads nothing", async () => {
    // `npx medusa exec … -- --dry-run --before=…` reaches the script as [].
    for (const args of [[], ["dry-run"]]) {
      const c = makeContainer([row("odsp_old")])
      await expect(exec(c.container, args)).rejects.toThrow(/cutoff is required/)
      expect(c.logger.error).toHaveBeenCalledWith(expect.stringContaining("refused"))
      expect(c.resolved).not.toContain(ORDER_DISPUTE_MODULE)
      expect(c.listOrderDisputes).not.toHaveBeenCalled()
    }
  })

  it("asks only for rows created before it", async () => {
    const c = makeContainer([])
    await exec(c.container, ["dry-run", `before=${CUTOFF}`])
    expect(c.listOrderDisputes).toHaveBeenCalled()
    expect(c.listOrderDisputes.mock.calls[0][0]).toEqual({ created_at: { $lt: new Date(CUTOFF) } })
  })

  it("cannot be called without one from code either", async () => {
    const c = makeContainer([row("odsp_old")])
    await expect(
      fixOrderDisputeMinorUnits(c.container, {} as unknown as { before: Date })
    ).rejects.toThrow(/cutoff/)
    expect(c.listOrderDisputes).not.toHaveBeenCalled()
  })
})

describe("fix-order-dispute-minor-units: what it writes", () => {
  it("corrects an unmarked old row and leaves a marked row with the same amounts alone", async () => {
    const marked = row("odsp_new", {
      metadata: { [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR, intake_source: "store/orders/[id]/dispute" },
    })
    const c = makeContainer([row("odsp_old"), marked])

    const summary = await fixOrderDisputeMinorUnits(c.container, { before: new Date(CUTOFF) })

    expect(summary.corrected).toEqual(["odsp_old"])
    expect(summary.skipped).toEqual([{ id: "odsp_new", reason: "marked_minor_units" }])
    expect(c.updateOrderDisputes).toHaveBeenCalledTimes(1)
    expect(c.updateOrderDisputes.mock.calls[0][0]).toMatchObject({
      id: "odsp_old",
      claim_amount: 2599,
      award_amount: 0,
    })
    expect(c.createOrderDisputeEvents).toHaveBeenCalledTimes(1)
  })

  it("writes nothing on a dry run", async () => {
    const c = makeContainer([row("odsp_old")])
    await exec(c.container, ["dry-run", `before=${CUTOFF}`])
    expect(c.updateOrderDisputes).not.toHaveBeenCalled()
    expect(c.createOrderDisputeEvents).not.toHaveBeenCalled()
    expect(c.logger.info.mock.calls.map((m) => String(m[0])).join("\n")).toMatch(/would correct odsp_old/)
  })
})
