import { PATCH } from "../route"
import { ORDER_DISPUTE_MODULE } from "../../../../../modules/order-dispute"
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
