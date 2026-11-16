import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import run, { fixOrderDisputeMinorUnits } from "../fix-order-dispute-minor-units"
import { ORDER_DISPUTE_MODULE } from "../../modules/order-dispute"
import { AMOUNT_UNIT_METADATA_KEY, AMOUNT_UNIT_MINOR, DisputeStatus } from "../../modules/order-dispute/resolution"

/**
 * The corrective script refuses to run without a cutoff or with any word it
 * does not know, writes only when told `apply`, asks the database only for
 * rows created before the cutoff, never writes a row the fixed intake marked
 * as minor units, and writes a row only if it is still what the correction
 * was planned from. Its decisions are tested in
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
  const correctAmountsIfUnchanged = jest.fn(async (_input: Record<string, unknown>) => true)
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
    [ORDER_DISPUTE_MODULE]: { listOrderDisputes, updateOrderDisputes, correctAmountsIfUnchanged, createOrderDisputeEvents },
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

  return {
    container,
    listOrderDisputes,
    updateOrderDisputes,
    correctAmountsIfUnchanged,
    createOrderDisputeEvents,
    logger,
    resolved,
  }
}

const exec = (container: MedusaContainer, args: string[]) =>
  run({ container, args } as unknown as ExecArgs)

describe("fix-order-dispute-minor-units: the cutoff", () => {
  it("refuses to run without one, and reads nothing", async () => {
    // `npx medusa exec … -- --dry-run --before=…` reaches the script as [].
    for (const args of [[], ["dry-run"], ["apply"]]) {
      const c = makeContainer([row("odsp_old")])
      await expect(exec(c.container, args)).rejects.toThrow(/cutoff is required/)
      expect(c.logger.error).toHaveBeenCalledWith(expect.stringContaining("refused"))
      expect(c.resolved).not.toContain(ORDER_DISPUTE_MODULE)
      expect(c.listOrderDisputes).not.toHaveBeenCalled()
    }
  })

  it("asks only for rows created before it, in a stable order (created_at, then id)", async () => {
    const c = makeContainer([])
    await exec(c.container, [`before=${CUTOFF}`])
    expect(c.listOrderDisputes).toHaveBeenCalled()
    expect(c.listOrderDisputes.mock.calls[0][0]).toEqual({ created_at: { $lt: new Date(CUTOFF) } })
    expect(c.listOrderDisputes.mock.calls[0][1]).toMatchObject({ order: { created_at: "ASC", id: "ASC" } })
  })

  it("refuses a mistyped dry-run, a repeated cutoff or a rolled-over date, and reads nothing", async () => {
    for (const args of [
      ["dryrun", `before=${CUTOFF}`],
      ["dry_run", `before=${CUTOFF}`],
      ["DRY-RUN", `before=${CUTOFF}`],
      [`before=${CUTOFF}`, "before=2020-01-01T00:00:00Z"],
      ["apply", "before=2026-02-30T15:00:00Z"],
    ]) {
      const c = makeContainer([row("odsp_old")])
      await expect(exec(c.container, args)).rejects.toThrow(/refused/)
      expect(c.resolved).not.toContain(ORDER_DISPUTE_MODULE)
      expect(c.correctAmountsIfUnchanged).not.toHaveBeenCalled()
    }
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
  it("corrects an unmarked old row, conditionally, and leaves a marked row with the same amounts alone", async () => {
    const marked = row("odsp_new", {
      metadata: { [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR, intake_source: "store/orders/[id]/dispute" },
    })
    const c = makeContainer([row("odsp_old"), marked])

    const summary = await fixOrderDisputeMinorUnits(c.container, { before: new Date(CUTOFF), apply: true })

    expect(summary.corrected).toEqual(["odsp_old"])
    expect(summary.skipped).toEqual([{ id: "odsp_new", reason: "marked_minor_units" }])
    // Never the unconditional update by id it used to be.
    expect(c.updateOrderDisputes).not.toHaveBeenCalled()
    expect(c.correctAmountsIfUnchanged).toHaveBeenCalledTimes(1)
    expect(c.correctAmountsIfUnchanged.mock.calls[0][0]).toMatchObject({
      id: "odsp_old",
      status: "open",
      from: { claim_amount: 25, award_amount: 0 },
      to: { claim_amount: 2599, award_amount: 0 },
      record: { by: "script:fix-order-dispute-minor-units", claim_amount: { from: 25, to: 2599 } },
    })
    expect(c.createOrderDisputeEvents).toHaveBeenCalledTimes(1)
  })

  it("writes nothing without `apply`, whether or not `dry-run` is said", async () => {
    for (const args of [[`before=${CUTOFF}`], ["dry-run", `before=${CUTOFF}`]]) {
      const c = makeContainer([row("odsp_old")])
      await exec(c.container, args)
      expect(c.correctAmountsIfUnchanged).not.toHaveBeenCalled()
      expect(c.updateOrderDisputes).not.toHaveBeenCalled()
      expect(c.createOrderDisputeEvents).not.toHaveBeenCalled()
      const info = c.logger.info.mock.calls.map((m) => String(m[0])).join("\n")
      expect(info).toMatch(/dry run/)
      expect(info).toMatch(/would correct odsp_old/)
    }
  })

  it("called from code, writes nothing unless `apply: true` is passed", async () => {
    const c = makeContainer([row("odsp_old")])
    const summary = await fixOrderDisputeMinorUnits(c.container, { before: new Date(CUTOFF) })
    expect(summary.corrected).toEqual(["odsp_old"])
    expect(c.correctAmountsIfUnchanged).not.toHaveBeenCalled()
    expect(c.createOrderDisputeEvents).not.toHaveBeenCalled()
  })

  it("writes with `apply`", async () => {
    const c = makeContainer([row("odsp_old")])
    await exec(c.container, ["apply", `before=${CUTOFF}`])
    expect(c.correctAmountsIfUnchanged).toHaveBeenCalledTimes(1)
    expect(c.createOrderDisputeEvents).toHaveBeenCalledTimes(1)
    expect(c.logger.info.mock.calls.map((m) => String(m[0])).join("\n")).toMatch(/\] corrected odsp_old/)
  })

  it("reports a row that changed since it was read for review, and writes no event for it", async () => {
    const c = makeContainer([row("odsp_old")])
    c.correctAmountsIfUnchanged.mockResolvedValueOnce(false)
    const summary = await fixOrderDisputeMinorUnits(c.container, { before: new Date(CUTOFF), apply: true })
    expect(summary.corrected).toEqual([])
    expect(summary.review).toEqual([{ id: "odsp_old", reason: expect.stringMatching(/changed since it was read/) }])
    expect(c.createOrderDisputeEvents).not.toHaveBeenCalled()
  })

  it("flags a correction to a case already decided as a refund, in the log line and the event", async () => {
    const refunded = row("odsp_refunded", { status: DisputeStatus.RESOLVED_REFUND, award_amount: 25 })
    const c = makeContainer([refunded, row("odsp_open")])
    await exec(c.container, ["apply", `before=${CUTOFF}`])

    const info = c.logger.info.mock.calls.map((m) => String(m[0]))
    expect(info.find((l) => l.includes("corrected odsp_refunded"))).toMatch(/check the Stripe refund matches the corrected award \(25 → 2599\)/)
    expect(info.find((l) => l.includes("corrected odsp_open"))).not.toMatch(/refund/)

    const events = c.createOrderDisputeEvents.mock.calls.map((call) => call[0][0] as { dispute_id: string; message: string; metadata: Record<string, unknown> })
    const refundEvent = events.find((e) => e.dispute_id === "odsp_refunded")!
    expect(refundEvent.message).toMatch(/already decided as a refund: check that the refund paid/)
    expect(refundEvent.metadata).toMatchObject({ refund_check: true, award_amount: { from: 25, to: 2599 } })
    expect(events.find((e) => e.dispute_id === "odsp_open")!.metadata.refund_check).toBeUndefined()
  })

  it("logs every skipped row with its reason, not just a count", async () => {
    const c = makeContainer([
      row("odsp_marked", { metadata: { [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR } }),
      row("odsp_done", { metadata: { amount_units_corrected: { at: "x" } } }),
    ])
    await exec(c.container, [`before=${CUTOFF}`])
    const info = c.logger.info.mock.calls.map((m) => String(m[0]))
    expect(info).toContain("[fix-order-dispute-minor-units] skipped odsp_marked: marked_minor_units")
    expect(info).toContain("[fix-order-dispute-minor-units] skipped odsp_done: already_corrected")
  })
})
