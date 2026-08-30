import {
  buildKarmaMirrorInput,
  mirrorXpEventsToKarma,
  normalizeKarmaReason,
} from "../karma-mirror"

/**
 * W4: the xp_event → karma_event mirror. xp_event stays what consumers
 * read; the canonical log absorbs it row-for-row via the scheduled sweep.
 * These tests pin the mapping (verbatim where possible, normalized where
 * necessary, clamped rather than dropped), the skip rules, and the
 * sweep's idempotent accounting against fake services.
 */

const xp = (overrides: Record<string, unknown> = {}) => ({
  id: "xp_1",
  customer_id: "cus_1",
  role: "PRODUCER",
  amount: 15,
  reason: "grower:order_placed",
  source_module: "orders",
  source_id: "order_1",
  occurred_at: "2026-08-30T00:00:00.000Z",
  ...overrides,
})

describe("normalizeKarmaReason", () => {
  it("passes the known XP vocabulary through verbatim", () => {
    for (const reason of [
      "order-placed",
      "grower:order_placed",
      "wellness:review_five_star",
      "karma-accrued",
      "verified",
    ]) {
      expect(normalizeKarmaReason(reason)).toBe(reason)
    }
  })

  it("normalizes unconventional reasons instead of wedging the mirror", () => {
    expect(normalizeKarmaReason("Order Placed!")).toBe("order-placed-")
    expect(normalizeKarmaReason("###")).toBe("xp-event")
  })
})

describe("buildKarmaMirrorInput", () => {
  it("maps the row onto the canonical write-path input", () => {
    expect(buildKarmaMirrorInput(xp())).toEqual({
      member_id: "cus_1",
      delta: 15,
      reason: "grower:order_placed",
      source_module: "progression",
      source_id: "xp_1",
      occurred_at: "2026-08-30T00:00:00.000Z",
      metadata: {
        xp_event_id: "xp_1",
        role: "PRODUCER",
        xp_source_module: "orders",
        xp_source_id: "order_1",
      },
    })
  })

  it("mirrors clawbacks with their sign", () => {
    const input = buildKarmaMirrorInput(xp({ amount: -10, reason: "order-canceled" }))
    expect(input?.delta).toBe(-10)
  })

  it("skips zero and non-integer amounts", () => {
    expect(buildKarmaMirrorInput(xp({ amount: 0 }))).toBeNull()
    expect(buildKarmaMirrorInput(xp({ amount: 1.5 }))).toBeNull()
  })

  it("clamps out-of-cap magnitudes rather than dropping the award", () => {
    const input = buildKarmaMirrorInput(xp({ amount: 50_000 }))
    expect(input?.delta).toBe(10_000)
    expect(input?.metadata.clamped_from).toBe(50_000)
  })
})

describe("mirrorXpEventsToKarma", () => {
  it("records each mirrorable row once and counts re-runs as already mirrored", async () => {
    const events = [
      xp({ id: "xp_1" }),
      xp({ id: "xp_2", amount: -5, reason: "order-canceled" }),
      xp({ id: "xp_zero", amount: 0 }),
    ]
    const seen = new Set<string>()
    const hawala = {
      recordKarmaEvent: jest.fn(async (input: { source_id: string }) => {
        const created = !seen.has(input.source_id)
        seen.add(input.source_id)
        return { event: { id: `ke_${input.source_id}` }, created }
      }),
    }
    const progression = { listXpEvents: jest.fn(async () => events) }

    const first = await mirrorXpEventsToKarma(progression, hawala)
    expect(first).toMatchObject({
      scanned: 3,
      mirrored: 2,
      already_mirrored: 0,
      skipped: 1,
      failed: 0,
    })

    const second = await mirrorXpEventsToKarma(progression, hawala)
    expect(second).toMatchObject({
      mirrored: 0,
      already_mirrored: 2,
      skipped: 1,
    })
  })

  it("captures per-row failures without aborting the sweep", async () => {
    const progression = {
      listXpEvents: jest.fn(async () => [xp({ id: "xp_ok" }), xp({ id: "xp_bad" })]),
    }
    const hawala = {
      recordKarmaEvent: jest.fn(async (input: { source_id: string }) => {
        if (input.source_id === "xp_bad") {
          throw new Error("[hawala-ledger] invalid karma event: boom")
        }
        return { event: { id: "ke_ok" }, created: true }
      }),
    }
    const summary = await mirrorXpEventsToKarma(progression, hawala)
    expect(summary.mirrored).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.errors[0]).toMatch(/xp_bad/)
  })
})
