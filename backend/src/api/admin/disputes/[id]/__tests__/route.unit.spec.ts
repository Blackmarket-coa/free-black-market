import { PATCH, parseAwardAmount } from "../route"
import { ORDER_DISPUTE_MODULE } from "../../../../../modules/order-dispute"
import OrderDisputeService from "../../../../../modules/order-dispute/service"
import {
  DECISIONS_NEEDING_A_NOTE,
  DisputeStatus,
  decisionNoteMissing,
} from "../../../../../modules/order-dispute/resolution"

/**
 * PATCH /admin/disputes/:id refuses a decision that closes the case without
 * a written reason. The buyer and the seller read that note in their own
 * claim records, and `/buyer-protection` promises one for every decision;
 * the admin panel asked for it, the server did not. The same refusal on a
 * real database: `integration-tests/http/admin-disputes.spec.ts`.
 *
 * src/api/admin/** is inside the `no-explicit-any` ratchet, so the doubles
 * are typed with narrow local shapes.
 */

type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

const dispute = { id: "odsp_1", status: "open", escrow_agreement_id: null }

function makeReq(body: Record<string, unknown>) {
  const service = {
    takeUnderReview: jest.fn(async (_a: Record<string, unknown>) => ({ ...dispute, status: "under_review" })),
    resolve: jest.fn(async (a: { status: string }) => ({ ...dispute, status: a.status })),
    withdraw: jest.fn(async (_a: Record<string, unknown>) => ({ ...dispute, status: "withdrawn" })),
  }
  const resolve = jest.fn((key: string) => {
    if (key === ORDER_DISPUTE_MODULE) return service
    throw new Error(`unexpected container key: ${key}`)
  })
  const req = {
    params: { id: "odsp_1" },
    body,
    scope: { resolve },
    auth_context: { actor_id: "user_1", actor_type: "user" },
  }
  return { req, service, resolve }
}

type RouteArgs = Parameters<typeof PATCH>
const invoke = async (body: Record<string, unknown>) => {
  const made = makeReq(body)
  const res = createRes()
  await PATCH(made.req as unknown as RouteArgs[0], res as unknown as RouteArgs[1])
  return { ...made, res }
}

describe("PATCH /admin/disputes/:id: a closing decision needs a note", () => {
  it("names exactly the three decisions that close a case", () => {
    expect([...DECISIONS_NEEDING_A_NOTE].sort()).toEqual(
      [DisputeStatus.RESOLVED_REFUND, DisputeStatus.RESOLVED_RELEASE, DisputeStatus.WITHDRAWN].sort()
    )
    expect(decisionNoteMissing(DisputeStatus.UNDER_REVIEW, undefined)).toBe(false)
    expect(decisionNoteMissing(DisputeStatus.RESOLVED_REFUND, " \n\t ")).toBe(true)
    expect(decisionNoteMissing(DisputeStatus.WITHDRAWN, 42)).toBe(true)
    expect(decisionNoteMissing(DisputeStatus.RESOLVED_RELEASE, "Signed for.")).toBe(false)
  })

  it.each([
    ["no note", {}],
    ["an empty note", { note: "" }],
    ["a blank note", { note: "   \n " }],
    ["a note that is not text", { note: 7 }],
  ])("refuses refund, release and withdrawal with %s: 400, and the case is not touched", async (_label, extra) => {
    for (const status of ["resolved_refund", "resolved_release", "withdrawn"]) {
      const { res, resolve } = await invoke({ status, ...extra })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "note_required" })
      expect(resolve).not.toHaveBeenCalled()
    }
  })

  it("decides with a note, stored without the surrounding whitespace", async () => {
    const refund = await invoke({ status: "resolved_refund", award_amount: 1250, note: "  Half arrived.  " })
    expect(refund.res.statusCode).toBe(200)
    expect(refund.service.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ status: "resolved_refund", awardCents: 1250, note: "Half arrived.", adminId: "user_1" })
    )

    const withdrawn = await invoke({ status: "withdrawn", note: "Buyer emailed to withdraw." })
    expect(withdrawn.res.statusCode).toBe(200)
    expect(withdrawn.service.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "admin", note: "Buyer emailed to withdraw." })
    )
  })

  it("does not ask for a note to take a case under review, which closes nothing", async () => {
    const { res, service } = await invoke({ status: "under_review" })
    expect(res.statusCode).toBe(200)
    expect(service.takeUnderReview).toHaveBeenCalledTimes(1)
  })
})

/**
 * `award_amount` is the figure an operator later pays out by hand. The PATCH
 * used to read any non-number as "no figure", which awards the whole claim:
 * the string "0" became a 2599 refund on a 2599 claim, -500 became a 0
 * refund recorded as resolved_refund, and 12.5 was floored to 12. Each case
 * below returned 200 with those awards before the fix.
 */
describe("PATCH /admin/disputes/:id: award_amount is a whole number of minor units or nothing", () => {
  it.each([
    ["the string \"0\"", "0"],
    ["the string \"1250\"", "1250"],
    ["the string \"12.50\"", "12.50"],
    ["a negative", -500],
    ["a fraction", 12.5],
    ["true", true],
    ["an array", [1250]],
    ["an object", { cents: 1250 }],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["an unsafe integer", 2 ** 53],
  ])("refuses %s with 400 invalid_award_amount, before the service is resolved", async (_label, award_amount) => {
    for (const status of ["resolved_refund", "resolved_release"]) {
      const { res, resolve, service } = await invoke({ status, award_amount, note: "Half arrived." })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "invalid_award_amount" })
      expect(resolve).not.toHaveBeenCalled()
      expect(service.resolve).not.toHaveBeenCalled()
    }
  })

  it("passes a whole number through unchanged, and no figure as null (the whole claim)", async () => {
    const exact = await invoke({ status: "resolved_refund", award_amount: 1250, note: "Half." })
    expect(exact.service.resolve).toHaveBeenCalledWith(expect.objectContaining({ awardCents: 1250 }))

    for (const extra of [{}, { award_amount: null }]) {
      const whole = await invoke({ status: "resolved_refund", note: "All of it.", ...extra })
      expect(whole.res.statusCode).toBe(200)
      expect(whole.service.resolve).toHaveBeenCalledWith(expect.objectContaining({ awardCents: null }))
    }
  })

  it("parseAwardAmount: absent or null is no figure; only a non-negative safe integer is one", () => {
    expect(parseAwardAmount(undefined)).toEqual({ ok: true, value: null })
    expect(parseAwardAmount(null)).toEqual({ ok: true, value: null })
    expect(parseAwardAmount(0)).toEqual({ ok: true, value: 0 })
    expect(parseAwardAmount(2599)).toEqual({ ok: true, value: 2599 })
    for (const bad of ["0", "", -1, 0.5, Number.NaN, 2 ** 53, false, [], {}]) {
      expect(parseAwardAmount(bad)).toEqual({ ok: false })
    }
  })
})

/**
 * The same route with the real `OrderDisputeService.resolve` (and so the real
 * `resolveAwardCents`) behind it, on a 2599 claim. Only the reads and writes
 * that need a database are doubles; `write` records what would be stored.
 */
describe("PATCH /admin/disputes/:id with the real resolve: what is recorded", () => {
  function realReq(body: Record<string, unknown>) {
    const row = {
      id: "odsp_1",
      status: DisputeStatus.OPEN,
      claim_amount: 2599,
      award_amount: 0,
      escrow_agreement_id: null,
    }
    const write = jest.fn(async (_row: unknown, _set: Record<string, unknown>) => undefined)
    const fake = {
      require: jest.fn(async () => row),
      writeIfStatusUnchanged: write,
      createOrderDisputeEvents: jest.fn(async (_e: unknown[]) => undefined),
    }
    const service = {
      resolve: (a: Parameters<OrderDisputeService["resolve"]>[0]) =>
        OrderDisputeService.prototype.resolve.call(fake as unknown as OrderDisputeService, a),
    }
    const req = {
      params: { id: "odsp_1" },
      body,
      scope: { resolve: (key: string) => (key === ORDER_DISPUTE_MODULE ? service : undefined) },
      auth_context: { actor_id: "user_1", actor_type: "user" },
    }
    return { req, write }
  }

  const send = async (body: Record<string, unknown>) => {
    const made = realReq(body)
    const res = createRes()
    await PATCH(made.req as unknown as RouteArgs[0], res as unknown as RouteArgs[1])
    return { res, write: made.write }
  }

  it("records an exact award, and the whole claim when none is sent", async () => {
    const exact = await send({ status: "resolved_refund", award_amount: 1250, note: "Half." })
    expect(exact.res.statusCode).toBe(200)
    expect(exact.write.mock.calls[0][1]).toMatchObject({ status: "resolved_refund", award_amount: 1250 })

    const whole = await send({ status: "resolved_refund", note: "All of it." })
    expect(whole.write.mock.calls[0][1]).toMatchObject({ award_amount: 2599 })
  })

  it("refuses a refund that awards nothing (use a release), with 400 and no write", async () => {
    const zero = await send({ status: "resolved_refund", award_amount: 0, note: "Nothing owed." })
    expect(zero.res.statusCode).toBe(400)
    expect(zero.res.body).toMatchObject({ type: "invalid_award_amount", message: expect.stringMatching(/resolved_release/) })
    expect(zero.write).not.toHaveBeenCalled()

    // A release with 0 is the right way to say it.
    const release = await send({ status: "resolved_release", award_amount: 0, note: "Nothing owed." })
    expect(release.res.statusCode).toBe(200)
    expect(release.write.mock.calls[0][1]).toMatchObject({ status: "resolved_release", award_amount: 0 })
  })

  it("answers an award the claim cannot carry with 400, not the 409 that means the case changed", async () => {
    for (const body of [
      { status: "resolved_refund", award_amount: 2600, note: "x" },
      { status: "resolved_release", award_amount: 5, note: "x" },
    ]) {
      const { res, write } = await send(body)
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "invalid_award_amount" })
      expect(write).not.toHaveBeenCalled()
    }
  })

  it("records none of the coerced figures the old check produced", async () => {
    for (const award_amount of ["0", -500, 12.5, 1250.9]) {
      const { res, write } = await send({ status: "resolved_refund", award_amount, note: "x" })
      expect(res.statusCode).toBe(400)
      expect(write).not.toHaveBeenCalled()
    }
  })
})
