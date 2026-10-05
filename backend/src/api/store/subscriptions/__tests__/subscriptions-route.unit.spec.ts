/**
 * A1–A3, unconditional store-route safety fixes:
 *   A1 POST /store/subscriptions refuses a cart that is not the caller's.
 *   A2 GET/POST /store/subscriptions/:id answer missing and not-owned with the
 *      same forbidden() 403 (no 404/403 existence oracle).
 *   A3 a refused transition (resume of a non-paused subscription) is a 409.
 *
 * The subscription service is the real prototype over a fake store; the
 * container resolves only the imported module keys.
 */
const createRun = jest.fn()
const manageRun = jest.fn()

jest.mock("../../../../workflows/subscription", () => ({
  createSubscriptionWorkflow: jest.fn(() => ({ run: createRun })),
  manageSubscriptionWorkflow: jest.fn(() => ({ run: manageRun })),
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST as createPOST } from "../route"
import { GET as getOne, POST as managePOST } from "../[id]/route"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import { SubscriptionInterval, SubscriptionStatus } from "../../../../modules/subscription/types"
import {
  makeContainer,
  makeSubscriptionService,
  type FakeRow,
} from "../../../../modules/subscription/__tests__/fake-subscription-service"

const FORBIDDEN_BODY = {
  message: "You do not have access to this record.",
  type: "not_allowed",
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: jest.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    json: jest.fn((body: unknown) => {
      res.body = body
      return res
    }),
  }
  return res
}

const subRow = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "sub_mine",
  status: SubscriptionStatus.ACTIVE,
  interval: SubscriptionInterval.MONTHLY,
  customer_id: "cus_me",
  last_order_date: new Date(),
  next_order_date: new Date(),
  expiration_date: new Date(Date.now() + 1e10),
  metadata: {},
  ...overrides,
})

function makeReq(opts: {
  rows?: FakeRow[]
  carts?: Array<{ id: string; customer_id: string | null }>
  body?: unknown
  params?: Record<string, string>
}) {
  const svc = makeSubscriptionService(opts.rows ?? [])
  const query = {
    graph: jest.fn(async ({ filters }: { filters: { id: string } }) => ({
      data: (opts.carts ?? []).filter((c) => c.id === filters.id),
    })),
  }
  const scope = makeContainer({
    [SUBSCRIPTION_MODULE]: svc,
    [ContainerRegistrationKeys.QUERY]: query,
  })
  const req = {
    auth_context: { actor_id: "cus_me", actor_type: "customer" },
    body: opts.body,
    params: opts.params ?? {},
    query: {},
    scope,
  }
  return { req: req as never, svc, query }
}

beforeEach(() => {
  createRun.mockReset().mockResolvedValue({ result: { subscription: { id: "sub_new" }, order: { id: "order_1" } } })
  manageRun.mockReset()
})

const body = { cart_id: "cart_x", interval: "monthly", period: 12 }

describe("A1 — POST /store/subscriptions cart ownership", () => {
  it("someone else's cart: forbidden(), nothing created", async () => {
    const { req, query } = makeReq({ body, carts: [{ id: "cart_x", customer_id: "cus_other" }] })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "cart", filters: { id: "cart_x" } })
    )
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN_BODY)
    expect(createRun).not.toHaveBeenCalled()
  })

  it("a missing cart gets the identical body", async () => {
    const { req } = makeReq({ body, carts: [] })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual(FORBIDDEN_BODY)
    expect(createRun).not.toHaveBeenCalled()
  })

  it("a guest cart (no customer) is not the caller's either", async () => {
    const { req } = makeReq({ body, carts: [{ id: "cart_x", customer_id: null }] })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(403)
    expect(createRun).not.toHaveBeenCalled()
  })

  it("the caller's own cart proceeds", async () => {
    const { req } = makeReq({ body, carts: [{ id: "cart_x", customer_id: "cus_me" }] })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(createRun).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(201)
  })
})

describe("A2 — /store/subscriptions/:id never splits 404/403", () => {
  const rows = [subRow(), subRow({ id: "sub_theirs", customer_id: "cus_other" })]

  it("GET: missing and not-owned are byte-identical 403s", async () => {
    const missing = makeRes()
    await getOne(makeReq({ rows, params: { id: "sub_nope" } }).req, missing as never)
    const theirs = makeRes()
    await getOne(makeReq({ rows, params: { id: "sub_theirs" } }).req, theirs as never)

    expect(missing.statusCode).toBe(403)
    expect(theirs.statusCode).toBe(403)
    expect(missing.body).toEqual(FORBIDDEN_BODY)
    expect(JSON.stringify(theirs.body)).toBe(JSON.stringify(missing.body))
  })

  it("GET: own subscription is returned", async () => {
    const res = makeRes()
    await getOne(makeReq({ rows, params: { id: "sub_mine" } }).req, res as never)
    expect(res.statusCode).toBe(200)
    expect((res.body as { subscription: { id: string } }).subscription.id).toBe("sub_mine")
  })

  it("POST: missing and not-owned are byte-identical 403s, and no workflow runs", async () => {
    const missing = makeRes()
    await managePOST(makeReq({ rows, params: { id: "sub_nope" }, body: { action: "cancel" } }).req, missing as never)
    const theirs = makeRes()
    await managePOST(makeReq({ rows, params: { id: "sub_theirs" }, body: { action: "cancel" } }).req, theirs as never)
    expect(missing.statusCode).toBe(403)
    expect(JSON.stringify(theirs.body)).toBe(JSON.stringify(missing.body))
    expect(manageRun).not.toHaveBeenCalled()
  })
})

describe("A3 — a refused transition is a 409", () => {
  it("resume of a canceled subscription: the real service refuses, the route answers 409", async () => {
    const { req, svc } = makeReq({
      rows: [subRow({ status: SubscriptionStatus.CANCELED })],
      params: { id: "sub_mine" },
      body: { action: "resume" },
    })
    // Run the real service method, then hand the route what the workflow
    // orchestrator would: the error SERIALISED (fields kept, prototype lost).
    manageRun.mockImplementation(async () => {
      try {
        await svc.resumeSubscription("sub_mine")
      } catch (e) {
        const err = e as Error & Record<string, unknown>
        throw { ...err, name: err.name, message: err.message }
      }
      return { result: {} }
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "subscription_transition_not_allowed" })
    expect(svc.store.get("sub_mine")?.status).toBe(SubscriptionStatus.CANCELED)
  })

  it("resume of a paused subscription succeeds", async () => {
    const { req, svc } = makeReq({
      rows: [subRow({ status: SubscriptionStatus.PAUSED })],
      params: { id: "sub_mine" },
      body: { action: "resume" },
    })
    manageRun.mockImplementation(async () => ({
      result: { subscription: await svc.resumeSubscription("sub_mine"), action: "resume", success: true },
    }))
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(200)
    expect(svc.store.get("sub_mine")?.status).toBe(SubscriptionStatus.ACTIVE)
  })
})
