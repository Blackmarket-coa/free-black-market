/**
 * The store routes under FF_CONSUMER_SUBSCRIPTIONS_V1: the affirmative
 * auto-renew answer on POST /store/subscriptions, and the disable / re-approve
 * actions on POST /store/subscriptions/:id. Flag off, both routes behave
 * exactly as before.
 *
 * Real code: both routes, the subscription service prototype over a fake
 * store (withdrawAutoRenew / approveAutoRenew), grace-lifecycle's product
 * lookup, auto-renew.ts's cart lookups and card save. Stubbed: the two
 * workflows (their insides have their own specs) — the create workflow's
 * input is what is asserted. The container resolves only imported keys.
 */
const createRun = jest.fn()
const manageRun = jest.fn()

jest.mock("../../../../workflows/subscription", () => ({
  createSubscriptionWorkflow: jest.fn(() => ({ run: createRun })),
  manageSubscriptionWorkflow: jest.fn(() => ({ run: manageRun })),
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST as createPOST } from "../route"
import { POST as managePOST } from "../[id]/route"
import { SUBSCRIPTION_MODULE } from "../../../../modules/subscription"
import { SubscriptionInterval, SubscriptionStatus } from "../../../../modules/subscription/types"
import {
  AUTO_RENEW_DISCLOSURE_VERSION,
  AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
} from "../../../../modules/subscription/utils/auto-renew"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import {
  makeContainer,
  makeSubscriptionService,
  type FakeRow,
} from "../../../../modules/subscription/__tests__/fake-subscription-service"

const FLAG = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1

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

type CartFixture = {
  id: string
  customer_id: string | null
  items: Array<{ id: string; product_id: string; quantity: number }>
  payment_method?: string
}

function makeReq(opts: {
  rows?: FakeRow[]
  carts?: CartFixture[]
  products?: Record<string, Record<string, unknown>>
  body?: unknown
  params?: Record<string, string>
}) {
  const svc = makeSubscriptionService(opts.rows ?? [])
  const query = {
    graph: jest.fn(
      async ({ entity, fields, filters }: { entity: string; fields: string[]; filters: { id: string } }) => {
        if (entity === "product") {
          const metadata = opts.products?.[filters.id]
          return { data: metadata ? [{ id: filters.id, metadata }] : [] }
        }
        if (entity !== "cart") throw new Error(`unexpected entity ${entity}`)
        const cart = (opts.carts ?? []).find((c) => c.id === filters.id)
        if (!cart) return { data: [] }
        if (fields.some((f) => f.startsWith("payment_collection"))) {
          return {
            data: [
              {
                id: cart.id,
                payment_collection: {
                  payment_sessions: [
                    {
                      id: "ps_1",
                      status: "authorized",
                      data: cart.payment_method ? { payment_method: cart.payment_method } : {},
                    },
                  ],
                },
              },
            ],
          }
        }
        if (fields.some((f) => f.startsWith("items"))) {
          return { data: [{ id: cart.id, items: cart.items }] }
        }
        return { data: [{ id: cart.id, customer_id: cart.customer_id }] }
      }
    ),
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

const myCart = (overrides: Partial<CartFixture> = {}): CartFixture => ({
  id: "cart_x",
  customer_id: "cus_me",
  items: [{ id: "item_1", product_id: "prod_vault", quantity: 1 }],
  payment_method: "pm_card",
  ...overrides,
})
const VAULT = { prod_vault: { subscription_until_canceled: true, subscription_interval: "monthly" } }
const base = { cart_id: "cart_x", interval: "monthly", period: 1 }

beforeEach(() => {
  createRun.mockReset()
  manageRun.mockReset()
})
afterEach(() => {
  delete process.env[FLAG]
})

/** The create workflow hands back the subscription the real step would create. */
function createReturns(sub: Record<string, unknown>, svc: ReturnType<typeof makeSubscriptionService>) {
  svc.store.set(String(sub.id), { status: SubscriptionStatus.ACTIVE, ...sub } as FakeRow)
  createRun.mockResolvedValue({ result: { subscription: sub, order: { id: "order_1" } } })
}

// ---------------------------------------------------------------------------
describe("POST /store/subscriptions — flag ON: the customer must answer", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("a missing answer is a 400 and nothing is completed", async () => {
    const { req } = makeReq({ body: base, carts: [myCart()], products: VAULT })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(400)
    expect(JSON.stringify(res.body)).toContain("auto_renew_approved")
    expect(createRun).not.toHaveBeenCalled()
  })

  it.each([["the string 'true'", "true"], ["null", null], ["1", 1]])(
    "a non-boolean answer (%s) is a 400",
    async (_label, value) => {
      const { req } = makeReq({
        body: { ...base, auto_renew_approved: value },
        carts: [myCart()],
        products: VAULT,
      })
      const res = makeRes()
      await createPOST(req, res as never)
      expect(res.statusCode).toBe(400)
      expect(createRun).not.toHaveBeenCalled()
    }
  )

  it("an approval without the disclosure version is a 400", async () => {
    const { req } = makeReq({
      body: { ...base, auto_renew_approved: true },
      carts: [myCart()],
      products: VAULT,
    })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(400)
    expect(createRun).not.toHaveBeenCalled()
  })

  it("someone else's cart is still forbidden() before anything else", async () => {
    const { req } = makeReq({
      body: { ...base, auto_renew_approved: false },
      carts: [myCart({ customer_id: "cus_other" })],
      products: VAULT,
    })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ message: "You do not have access to this record.", type: "not_allowed" })
    expect(createRun).not.toHaveBeenCalled()
  })

  it("an approval of a stale disclosure is a 409", async () => {
    const { req } = makeReq({
      body: { ...base, auto_renew_approved: true, auto_renew_disclosure_version: "2025-01-01" },
      carts: [myCart()],
      products: VAULT,
    })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "auto_renew_disclosure_outdated" })
    expect(createRun).not.toHaveBeenCalled()
  })

  it("a cart with more than one line is a 400", async () => {
    const { req } = makeReq({
      body: { ...base, auto_renew_approved: false },
      carts: [
        myCart({
          items: [
            { id: "item_1", product_id: "prod_vault", quantity: 1 },
            { id: "item_2", product_id: "prod_other", quantity: 1 },
          ],
        }),
      ],
      products: VAULT,
    })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ type: "subscription_cart_single_item" })
    expect(createRun).not.toHaveBeenCalled()
  })

  it("approval for a product not marked subscribable is a 409", async () => {
    const { req } = makeReq({
      body: { ...base, auto_renew_approved: true, auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION },
      carts: [myCart()],
      products: { prod_vault: {} },
    })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "auto_renew_not_offered" })
    expect(createRun).not.toHaveBeenCalled()
  })

  it("a single line of quantity 2 is a 400 (a renewal would re-buy both)", async () => {
    const { req } = makeReq({
      body: { ...base, auto_renew_approved: false },
      carts: [myCart({ items: [{ id: "item_1", product_id: "prod_vault", quantity: 2 }] })],
      products: VAULT,
    })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ type: "subscription_cart_single_item" })
    expect(createRun).not.toHaveBeenCalled()
  })

  it.each([
    ["approved", { auto_renew_approved: true, auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION }],
    ["declined", { auto_renew_approved: false }],
  ])("%s with an interval other than the product's is a 409", async (_label, answer) => {
    const { req } = makeReq({
      body: { ...base, interval: "weekly", ...answer },
      carts: [myCart()],
      products: VAULT,
    })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "subscription_interval_mismatch" })
    expect(createRun).not.toHaveBeenCalled()
  })

  it("approved for a marked product that names no interval is a 409", async () => {
    const { req } = makeReq({
      body: { ...base, auto_renew_approved: true, auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION },
      carts: [myCart()],
      products: { prod_vault: { subscription_until_canceled: true } },
    })
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "subscription_interval_mismatch" })
    expect(createRun).not.toHaveBeenCalled()
  })

  it("approved: the answer, version and a server timestamp reach the workflow, and the card is kept", async () => {
    const { req, svc } = makeReq({
      body: { ...base, auto_renew_approved: true, auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION },
      carts: [myCart()],
      products: VAULT,
    })
    createReturns({ id: "sub_new", auto_renew_approved: true, expiration_date: null }, svc)
    const before = Date.now()
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(201)
    const input = createRun.mock.calls[0][0].input
    expect(input.subscription_data.auto_renew).toEqual({
      approved: true,
      disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
      approved_at: expect.any(String),
    })
    expect(new Date(input.subscription_data.auto_renew.approved_at).getTime()).toBeGreaterThanOrEqual(
      before - 1
    )
    expect(svc.store.get("sub_new")?.payment_method_id).toBe("pm_card")
  })

  it("declined: recorded as declined with no version, and the card is NOT kept", async () => {
    const { req, svc, query } = makeReq({
      body: { ...base, auto_renew_approved: false, auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION },
      carts: [myCart()],
      products: VAULT,
    })
    createReturns(
      { id: "sub_new", auto_renew_approved: false, expiration_date: new Date(Date.now() + 1e9) },
      svc
    )
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(201)
    expect(createRun.mock.calls[0][0].input.subscription_data.auto_renew).toMatchObject({
      approved: false,
      disclosure_version: null,
    })
    expect(svc.store.get("sub_new")?.payment_method_id).toBeUndefined()
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
    const paymentLookups = query.graph.mock.calls.filter(([args]) =>
      args.fields.some((f: string) => f.startsWith("payment_collection"))
    )
    expect(paymentLookups).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe("POST /store/subscriptions — flag OFF is unchanged", () => {
  it("no answer needed; the workflow input is exactly the legacy one; one cart read; nothing saved", async () => {
    const { req, svc, query } = makeReq({
      body: { ...base, period: 12, auto_renew_approved: true },
      carts: [myCart()],
      products: VAULT,
    })
    createReturns({ id: "sub_new", auto_renew_approved: true, expiration_date: null }, svc)
    const res = makeRes()
    await createPOST(req, res as never)
    expect(res.statusCode).toBe(201)
    expect(createRun.mock.calls[0][0]).toEqual({
      input: {
        cart_id: "cart_x",
        subscription_data: {
          interval: "monthly",
          period: 12,
          type: undefined,
          delivery_day: undefined,
          delivery_instructions: undefined,
        },
      },
    })
    expect(query.graph).toHaveBeenCalledTimes(1)
    expect(query.graph.mock.calls[0][0]).toEqual({
      entity: "cart",
      fields: ["id", "customer_id"],
      filters: { id: "cart_x" },
    })
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe("POST /store/subscriptions/:id — disable / re-approve", () => {
  const approvedRow = (overrides: Partial<FakeRow> = {}): FakeRow => ({
    id: "sub_mine",
    status: SubscriptionStatus.ACTIVE,
    interval: SubscriptionInterval.MONTHLY,
    customer_id: "cus_me",
    product_id: "prod_vault",
    last_order_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    next_order_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    expiration_date: null,
    payment_method_id: "pm_card",
    auto_renew_approved: true,
    metadata: {},
    ...overrides,
  })

  it("flag ON: disable_auto_renew keeps the seat active to the paid period end, nothing scheduled", async () => {
    process.env[FLAG] = "true"
    const { req, svc } = makeReq({
      rows: [approvedRow()],
      params: { id: "sub_mine" },
      body: { action: "disable_auto_renew" },
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(200)
    const stored = svc.store.get("sub_mine") as FakeRow
    expect(stored.status).toBe(SubscriptionStatus.ACTIVE)
    expect(stored.auto_renew_approved).toBe(false)
    expect(stored.next_order_date).toBeNull()
    expect(new Date(stored.expiration_date as Date).getTime()).toBeGreaterThan(Date.now())
    expect(manageRun).not.toHaveBeenCalled()
  })

  it("flag ON: disable on someone else's subscription is the one forbidden() body", async () => {
    process.env[FLAG] = "true"
    const { req, svc } = makeReq({
      rows: [approvedRow({ customer_id: "cus_other" })],
      params: { id: "sub_mine" },
      body: { action: "disable_auto_renew" },
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(403)
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("flag OFF: disable_auto_renew is the legacy validation 400 and writes nothing", async () => {
    const { req, svc } = makeReq({
      rows: [approvedRow()],
      params: { id: "sub_mine" },
      body: { action: "disable_auto_renew" },
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ message: "Validation failed" })
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  const singleRow = () =>
    approvedRow({
      auto_renew_approved: false,
      next_order_date: null,
      expiration_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    })

  it("flag ON: re-approval with a stale version is a 409 and writes nothing", async () => {
    process.env[FLAG] = "true"
    const { req, svc } = makeReq({
      rows: [singleRow()],
      products: VAULT,
      params: { id: "sub_mine" },
      body: { action: "approve_auto_renew", auto_renew_approved: true, auto_renew_disclosure_version: "2026-01-01" },
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "auto_renew_disclosure_outdated" })
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("flag ON: re-approval with the PURCHASE disclosure version is a 409 (different wording)", async () => {
    process.env[FLAG] = "true"
    const { req, svc } = makeReq({
      rows: [singleRow()],
      products: VAULT,
      params: { id: "sub_mine" },
      body: {
        action: "approve_auto_renew",
        auto_renew_approved: true,
        auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
      },
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "auto_renew_disclosure_outdated" })
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("flag ON: re-approval without an explicit true is a 400", async () => {
    process.env[FLAG] = "true"
    const { req, svc } = makeReq({
      rows: [singleRow()],
      products: VAULT,
      params: { id: "sub_mine" },
      body: { action: "approve_auto_renew", auto_renew_disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION },
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(400)
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("flag ON: re-approval with the current version turns renewal back on", async () => {
    process.env[FLAG] = "true"
    const row = singleRow()
    const { req, svc } = makeReq({
      rows: [row],
      products: VAULT,
      params: { id: "sub_mine" },
      body: {
        action: "approve_auto_renew",
        auto_renew_approved: true,
        auto_renew_disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
      },
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(200)
    const stored = svc.store.get("sub_mine") as FakeRow
    expect(stored.auto_renew_approved).toBe(true)
    expect(stored.auto_renew_disclosure_version).toBe(AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION)
    expect(stored.auto_renew_approved_at).toBeInstanceOf(Date)
    expect(stored.expiration_date).toBeNull()
    expect(stored.next_order_date).toEqual(row.expiration_date)
  })

  it("flag ON: re-approval for a product no longer marked is a 409", async () => {
    process.env[FLAG] = "true"
    const { req, svc } = makeReq({
      rows: [singleRow()],
      products: { prod_vault: {} },
      params: { id: "sub_mine" },
      body: {
        action: "approve_auto_renew",
        auto_renew_approved: true,
        auto_renew_disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
      },
    })
    const res = makeRes()
    await managePOST(req, res as never)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "auto_renew_not_offered" })
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })
})
