import { GET as listQueue } from "../route"
import { GET as readOne } from "../[charge_id]/route"
import { POST as assign } from "../[charge_id]/assign/route"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import {
  assignDisputeFee,
  DisputeFeeAssignmentError,
  listUnassignedDisputeFees,
  readDisputeFee,
} from "../../../../../lib/card-dispute-fee-assignment"

/**
 * The SD-44 (a) admin routes' own gates; the assignment itself is proved on a
 * real database (integration-tests/http/hawala-dispute-fee-assignment.spec.ts).
 *
 *   - dark without FF_CARD_ORDER_LEDGER_V1: 404 feature_disabled in each
 *     handler, which then reads nothing (the middleware matcher is the
 *     same `requireFeatureFlagMiddleware` the card-refund spec proves);
 *   - an assignment must be a well-formed body and name its admin (400 /
 *     401), checked before anything is read or written;
 *   - a DisputeFeeAssignmentError maps to its status, with its details.
 */

jest.mock("../../../../../lib/card-dispute-fee-assignment", () => ({
  ...jest.requireActual("../../../../../lib/card-dispute-fee-assignment"),
  assignDisputeFee: jest.fn(),
  readDisputeFee: jest.fn(),
  listUnassignedDisputeFees: jest.fn(),
}))
const assignFn = assignDisputeFee as jest.MockedFunction<typeof assignDisputeFee>
const readFn = readDisputeFee as jest.MockedFunction<typeof readDisputeFee>
const listFn = listUnassignedDisputeFees as jest.MockedFunction<typeof listUnassignedDisputeFees>

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}
const createRes = (): TestRes => {
  const res = { statusCode: 200, body: {} } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload as Record<string, unknown>
    return res
  }
  return res
}

const scope = { resolve: (key: string) => { throw new Error(`scope resolved ${key}`) } }
const req = (over: Record<string, unknown> = {}) =>
  ({
    scope,
    params: { charge_id: "ch_1" },
    query: {},
    body: {},
    auth_context: { actor_id: "user_admin_1" },
    ...over,
  }) as never

afterEach(() => {
  delete process.env[CARD]
  assignFn.mockReset()
  readFn.mockReset()
  listFn.mockReset()
})

describe("flag off: dark", () => {
  it.each([
    ["GET queue", listQueue],
    ["GET one", readOne],
    ["POST assign", assign],
  ])("%s: 404 feature_disabled and nothing read", async (_n, handler) => {
    const res = createRes()
    await (handler as (r: never, s: never) => Promise<unknown>)(req({ body: { allocations: [{ order_id: "o", amount: 1 }] } }), res as never)
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ type: "feature_disabled" })
    expect(assignFn).not.toHaveBeenCalled()
    expect(readFn).not.toHaveBeenCalled()
    expect(listFn).not.toHaveBeenCalled()
  })
})

describe("flag on", () => {
  beforeEach(() => {
    process.env[CARD] = "true"
  })

  it("GET one: 404 when no fee is recorded on the charge", async () => {
    readFn.mockResolvedValue(null)
    const res = createRes()
    await readOne(req(), res as never)
    expect(res.statusCode).toBe(404)
  })

  it("GET queue: the queue and its count", async () => {
    listFn.mockResolvedValue([])
    const res = createRes()
    await listQueue(req(), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ dispute_fees: [], count: 0 })
  })

  it("POST assign: a malformed body is 400 before anything is read", async () => {
    for (const body of [
      {},
      { allocations: [] },
      { allocations: [], bmc_absorbs: 0 },
      { allocations: [{ order_id: "o", amount: -1 }] },
      { allocations: [{ order_id: "o", amount: 1, extra: 1 }] },
      { allocations: [{ order_id: "o", amount: 1 }], bmc_absorbs: -1 },
      { allocations: [{ order_id: "o", amount: 1 }], unknown: true },
    ]) {
      const res = createRes()
      await assign(req({ body }), res as never)
      expect(res.statusCode).toBe(400)
    }
    expect(assignFn).not.toHaveBeenCalled()
  })

  it("POST assign: no admin actor is 401, and nothing is assigned", async () => {
    const res = createRes()
    await assign(req({ body: { allocations: [{ order_id: "o", amount: 1 }] }, auth_context: {} }), res as never)
    expect(res.statusCode).toBe(401)
    expect(assignFn).not.toHaveBeenCalled()
  })

  it.each([
    ["amount_mismatch", 400],
    ["invalid_allocation", 400],
    ["order_not_settled", 400],
    ["nothing_to_assign", 409],
    ["automatic", 409],
    ["not_found", 404],
  ] as const)("POST assign: %s is %i, with its details", async (code, status) => {
    assignFn.mockRejectedValue(new DisputeFeeAssignmentError(code, "no", { unassigned_cents: 1500 }))
    const res = createRes()
    await assign(req({ body: { allocations: [{ order_id: "o", amount: 1 }] } }), res as never)
    expect(res.statusCode).toBe(status)
    expect(res.body).toMatchObject({ type: code, unassigned_cents: 1500 })
  })

  it("POST assign: passes the admin actor through as who assigned it, and BMC's part when given", async () => {
    assignFn.mockResolvedValue({ stripe_charge_id: "ch_1", posted: [], absorbed_cents: 1500, unassigned_cents: 0 })
    let res = createRes()
    await assign(req({ body: { bmc_absorbs: 15 } }), res as never)
    expect(res.statusCode).toBe(200)
    expect(assignFn).toHaveBeenLastCalledWith(scope, {
      stripe_charge_id: "ch_1",
      allocations: [],
      bmc_absorbs: 15,
      actor_id: "user_admin_1",
    })
    res = createRes()
    await assign(req({ body: { allocations: [{ order_id: "o", amount: 15 }] } }), res as never)
    expect(assignFn).toHaveBeenLastCalledWith(scope, {
      stripe_charge_id: "ch_1",
      allocations: [{ order_id: "o", amount: 15 }],
      actor_id: "user_admin_1",
    })
  })
})
