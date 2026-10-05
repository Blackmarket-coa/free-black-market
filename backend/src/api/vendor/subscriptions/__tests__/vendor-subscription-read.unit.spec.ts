/**
 * GET /vendor/subscriptions/:id — missing and another seller's subscription
 * answer with the same forbidden() 403 (no 404/403 existence oracle), the
 * D10-5 rule the store routes already follow.
 *
 * Real code: the route and the subscription service prototype over a fake
 * store. Stubbed: requireSellerId (the seller-resolution path has its own
 * specs).
 */
jest.mock("../../../../shared", () => ({
  requireSellerId: jest.fn(async () => "sel_me"),
}))

import { GET } from "../[id]/route"
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

const subRow = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "sub_mine",
  status: SubscriptionStatus.ACTIVE,
  interval: SubscriptionInterval.MONTHLY,
  customer_id: "cus_1",
  seller_id: "sel_me",
  metadata: {},
  ...overrides,
})

async function call(id: string) {
  const svc = makeSubscriptionService([subRow(), subRow({ id: "sub_theirs", seller_id: "sel_other" })])
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
  const req = {
    params: { id },
    scope: makeContainer({ [SUBSCRIPTION_MODULE]: svc }),
  }
  await GET(req as never, res as never)
  return res
}

describe("GET /vendor/subscriptions/:id", () => {
  it("returns the seller's own subscription", async () => {
    const res = await call("sub_mine")
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ subscription: { id: "sub_mine" } })
  })

  it("missing and not-owned are indistinguishable: one 403, one body", async () => {
    const missing = await call("sub_nope")
    const theirs = await call("sub_theirs")
    expect(missing.statusCode).toBe(403)
    expect(theirs.statusCode).toBe(403)
    expect(missing.body).toEqual(FORBIDDEN_BODY)
    expect(theirs.body).toEqual(FORBIDDEN_BODY)
  })
})
