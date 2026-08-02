import { POST } from "../webhooks/route"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../modules/marketplace-webhooks"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import { WebhookSubscriptionStatus } from "../../../../modules/marketplace-webhooks/models/webhook-subscription"
import { clearPlanFeatureCache } from "../../../../shared/plan-entitlement-cache"
import { limitsForPlan } from "../../../../modules/vendor-plan/limits"

/**
 * `/v1/seller/*` resolves its seller from `req.seller_id` (seller-context-v1),
 * not from `requireSellerId` — so this covers the limit check on that shape as
 * well as the cap itself.
 */

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: Record<string, unknown>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

const VALID_BODY = {
  url: "https://vendor.example.com/hooks/fbm",
  events: ["creator.payout.completed"],
}

const makeReq = (opts: {
  planCode?: string
  existing?: { status: string }[]
  sellerId?: string | null
  body?: unknown
}) => {
  const createSubscription = jest.fn(async () => ({
    id: "whs_1",
    url: VALID_BODY.url,
    events: VALID_BODY.events,
    status: WebhookSubscriptionStatus.ACTIVE,
    secret: "fbm_whsec_x",
  }))

  const listWebhookSubscriptions = jest.fn(async () => opts.existing ?? [])

  return {
    req: {
      body: opts.body ?? VALID_BODY,
      seller_id: opts.sellerId === undefined ? "sel_1" : opts.sellerId,
      scope: {
        resolve: (key: string) => {
          if (key === MARKETPLACE_WEBHOOKS_MODULE) {
            return { listWebhookSubscriptions, createSubscription }
          }
          if (key === VENDOR_PLAN_MODULE) {
            return {
              ensureAssignment: async () => ({
                plan_code: opts.planCode ?? "free",
              }),
              getEntitledFeatureKeys: async () => [],
            }
          }
          if (key === ENTITLEMENT_MODULE) {
            return { listActiveFeatureKeysForSeller: async () => [] }
          }
          return undefined
        },
      },
    },
    createSubscription,
    listWebhookSubscriptions,
  }
}

beforeEach(() => {
  clearPlanFeatureCache()
})

describe("POST /v1/seller/webhooks", () => {
  it("creates a subscription while under the plan's cap", async () => {
    const { req, createSubscription } = makeReq({ planCode: "free", existing: [] })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createSubscription).toHaveBeenCalled()
  })

  it("refuses with a 402 at the cap", async () => {
    const free = limitsForPlan("free").webhook_subscriptions as number
    const { req, createSubscription } = makeReq({
      planCode: "free",
      existing: Array.from({ length: free }, () => ({
        status: WebhookSubscriptionStatus.ACTIVE,
      })),
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(402)
    expect(res.body.code).toBe("plan_limit_reached")
    expect(res.body.limit_key).toBe("webhook_subscriptions")
    expect(createSubscription).not.toHaveBeenCalled()
  })

  it("counts only active subscriptions", async () => {
    // A disabled endpoint delivers nothing, so holding one should not stop a
    // vendor replacing it.
    const { req, listWebhookSubscriptions } = makeReq({
      planCode: "free",
      existing: [],
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(listWebhookSubscriptions).toHaveBeenCalledWith({
      seller_id: "sel_1",
      status: WebhookSubscriptionStatus.ACTIVE,
    })
  })

  it("lets a higher plan hold more endpoints", async () => {
    const { req, createSubscription } = makeReq({
      planCode: "pro",
      existing: Array.from({ length: 3 }, () => ({
        status: WebhookSubscriptionStatus.ACTIVE,
      })),
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createSubscription).toHaveBeenCalled()
  })

  it("rejects a bad payload before spending a plan lookup", async () => {
    const { req, listWebhookSubscriptions } = makeReq({
      planCode: "free",
      body: { url: "http://insecure.example.com", events: [] },
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(listWebhookSubscriptions).not.toHaveBeenCalled()
  })

  it("still 401s without a seller", async () => {
    const { req } = makeReq({ sellerId: null })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(401)
  })
})
