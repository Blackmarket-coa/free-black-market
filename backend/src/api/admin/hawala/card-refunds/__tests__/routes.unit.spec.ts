import { GET as readCollection } from "../[payment_collection_id]/route"
import { POST as attribute } from "../[payment_collection_id]/attribute/route"
import { GET as listHolds } from "../../payout-holds/route"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import { requireFeatureFlagMiddleware } from "../../../../../shared/runtime-module-gates"
import { attributeCollectionRefund, RefundAttributionError } from "../../../../../lib/card-refund-attribution"
import { HAWALA_LEDGER_MODULE } from "../../../../../modules/hawala-ledger"

/**
 * The SD-40 admin routes' own gates; the assignment itself is proved on a
 * real database (integration-tests/http/hawala-vendor-refund-receivable.spec.ts).
 *
 *   - dark without FF_CARD_ORDER_LEDGER_V1: 404 feature_disabled through the
 *     real middleware AND in each handler, which then reads nothing;
 *   - an assignment must be a well-formed body and name its admin (400 / 401),
 *     checked before anything is read or written;
 *   - a RefundAttributionError maps to its status, with its details.
 */

jest.mock("../../../../../lib/card-refund-attribution", () => ({
  ...jest.requireActual("../../../../../lib/card-refund-attribution"),
  attributeCollectionRefund: jest.fn(),
  readCollectionRefunds: jest.fn(),
}))
const assign = attributeCollectionRefund as jest.MockedFunction<typeof attributeCollectionRefund>

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

/** A scope that throws on every key: a handler that reaches it fails the test. */
const untouchable = {
  resolve: (key: string) => {
    throw new Error(`scope resolved ${key}`)
  },
}

const req = (over: Record<string, unknown> = {}) =>
  ({
    scope: untouchable,
    params: { payment_collection_id: "pay_col_1" },
    query: {},
    body: {},
    auth_context: { actor_id: "user_admin_1" },
    ...over,
  }) as never

afterEach(() => {
  delete process.env[CARD]
  assign.mockReset()
})

describe("flag off: dark", () => {
  it("the middleware answers 404 and never calls next", async () => {
    const res = createRes()
    const next = jest.fn()
    await requireFeatureFlagMiddleware("CARD_ORDER_LEDGER_V1")(req(), res as never, next)
    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  it.each([
    ["GET collection", readCollection],
    ["POST attribute", attribute],
    ["GET holds", listHolds],
  ])("%s: the handler repeats the check and reads nothing", async (_name, handler) => {
    const res = createRes()
    await (handler as (r: never, s: never) => Promise<unknown>)(req({ body: { allocations: [] } }), res as never)
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ type: "feature_disabled" })
  })
})

describe("flag on", () => {
  beforeEach(() => {
    process.env[CARD] = "true"
  })

  it("POST attribute: a malformed body is 400 before anything is read", async () => {
    for (const body of [{}, { allocations: [] }, { allocations: [{ order_id: "o", amount: -1 }] }, { allocations: [{ order_id: "o", amount: 1, extra: 1 }] }]) {
      const res = createRes()
      await attribute(req({ body }), res as never)
      expect(res.statusCode).toBe(400)
    }
    expect(assign).not.toHaveBeenCalled()
  })

  it("POST attribute: no admin actor is 401, and nothing is assigned", async () => {
    const res = createRes()
    await attribute(req({ body: { allocations: [{ order_id: "o", amount: 1 }] }, auth_context: {} }), res as never)
    expect(res.statusCode).toBe(401)
    expect(assign).not.toHaveBeenCalled()
  })

  it.each([
    ["amount_mismatch", 400],
    ["invalid_allocation", 400],
    ["nothing_to_assign", 409],
    ["not_shared", 409],
    ["not_found", 404],
  ] as const)("POST attribute: %s is %i, with its details", async (code, status) => {
    assign.mockRejectedValue(new RefundAttributionError(code, "no", { unassigned: 20 }))
    const res = createRes()
    await attribute(req({ body: { allocations: [{ order_id: "o", amount: 1 }] } }), res as never)
    expect(res.statusCode).toBe(status)
    expect(res.body).toMatchObject({ type: code, unassigned: 20 })
  })

  it("POST attribute: passes the admin actor through as who assigned it", async () => {
    assign.mockResolvedValue({
      payment_collection_id: "pay_col_1",
      assigned: [],
      released_hold_ids: [],
      reconciled: [],
    })
    const res = createRes()
    await attribute(req({ body: { allocations: [{ order_id: "o", amount: 1 }] } }), res as never)
    expect(res.statusCode).toBe(200)
    expect(assign).toHaveBeenCalledWith(untouchable, {
      payment_collection_id: "pay_col_1",
      allocations: [{ order_id: "o", amount: 1 }],
      actor_id: "user_admin_1",
    })
  })

  it("GET holds: only ACTIVE or RELEASED, ACTIVE by default", async () => {
    const listPayoutHolds = jest.fn(async () => [])
    const scope = {
      resolve: (key: string) => {
        if (key !== HAWALA_LEDGER_MODULE) throw new Error(`scope resolved ${key}`)
        return { listPayoutHolds }
      },
    }
    let res = createRes()
    await listHolds(req({ scope, query: { status: "everything" } }), res as never)
    expect(res.statusCode).toBe(400)
    res = createRes()
    await listHolds(req({ scope }), res as never)
    expect(res.statusCode).toBe(200)
    expect(listPayoutHolds).toHaveBeenCalledWith({ status: "ACTIVE" }, expect.anything())
  })
})
