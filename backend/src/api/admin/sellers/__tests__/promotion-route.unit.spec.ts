import { DELETE, GET, POST } from "../[id]/promotion/route"
import * as vendorPromotionRoute from "../../../vendor/promotion/route"

const VENDOR_GET = vendorPromotionRoute.GET
import { PROMOTED_LISTING_FEATURE_KEY } from "../../../../shared/promoted-listing"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.mock("../../../../shared", () => ({
  requireSellerId: jest.fn(async () => "sel_1"),
}))

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

const makeReq = (opts: {
  sellerId?: string
  body?: unknown
  expiresAt?: Date | null
  hasPromotion?: boolean
} = {}) => {
  const metadata = [{ id: "sm_1", seller_id: "sel_1", featured: false }]
  const entitlements = opts.hasPromotion
    ? [
        {
          seller_id: "sel_1",
          feature_key: PROMOTED_LISTING_FEATURE_KEY,
          status: "active",
          expires_at: opts.expiresAt ?? null,
          created_at: new Date("2026-08-01"),
        },
      ]
    : []

  const grant = jest.fn(async () => ({}))
  const revokeSellerFeatureKeys = jest.fn(async () => 1)

  return {
    req: {
      params: { id: opts.sellerId === undefined ? "sel_1" : opts.sellerId },
      body: opts.body,
      scope: {
        resolve: (key: string) => {
          if (key === ENTITLEMENT_MODULE) {
            return {
              listEntitlements: async () => entitlements,
              grant,
              revokeSellerFeatureKeys,
            }
          }
          if (key === ContainerRegistrationKeys.QUERY) {
            return { graph: async () => ({ data: metadata }) }
          }
          if (key === "sellerExtension") {
            return { updateSellerMetadata: async () => [] }
          }
          return undefined
        },
      },
    },
    grant,
    revokeSellerFeatureKeys,
  }
}

describe("GET /admin/sellers/:id/promotion", () => {
  it("reports no promotion and still lists the tiers", async () => {
    const { req } = makeReq()
    const res = createRes()
    await GET(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect((res.body.promotion as Record<string, unknown>).active).toBe(false)
    expect((res.body.tiers as unknown[]).length).toBeGreaterThan(0)
  })

  it("requires a seller id", async () => {
    const { req } = makeReq({ sellerId: "" })
    const res = createRes()
    await GET(req as never, res as never)
    expect(res.statusCode).toBe(400)
  })
})

describe("POST /admin/sellers/:id/promotion", () => {
  it("grants a tiered promotion", async () => {
    const { req, grant } = makeReq({ body: { tier_code: "month" } })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(grant).toHaveBeenCalled()
    expect((res.body.promotion as Record<string, unknown>).active).toBe(true)
  })

  it("rejects an unknown tier before touching entitlements", async () => {
    const { req, grant } = makeReq({ body: { tier_code: "forever" } })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(res.body.valid_tiers).toBeDefined()
    expect(grant).not.toHaveBeenCalled()
  })

  it("grants an open-ended promotion with no tier", async () => {
    const { req, grant } = makeReq({ body: {} })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect((res.body.promotion as Record<string, unknown>).expires_at).toBeNull()
    expect(grant).toHaveBeenCalled()
  })
})

describe("DELETE /admin/sellers/:id/promotion", () => {
  it("revokes the promotion", async () => {
    const { req, revokeSellerFeatureKeys } = makeReq({ hasPromotion: true })
    const res = createRes()
    await DELETE(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.revoked).toBe(true)
    expect(revokeSellerFeatureKeys).toHaveBeenCalledWith(
      "sel_1",
      [PROMOTED_LISTING_FEATURE_KEY],
      undefined
    )
  })
})

describe("GET /vendor/promotion", () => {
  it("shows the tiers without a buy button while billing is off", async () => {
    // `purchasable` now reflects isVendorBillingConfigured(); pin the env off
    // so this test says what it means regardless of the CI environment.
    const saved = process.env.VENDOR_BILLING_ENABLED
    delete process.env.VENDOR_BILLING_ENABLED
    try {
      const { req } = makeReq()
      const res = createRes()
      await VENDOR_GET(req as never, res as never)

      expect(res.statusCode).toBe(200)
      expect(res.body.purchasable).toBe(false)
      expect((res.body.tiers as unknown[]).length).toBeGreaterThan(0)
    } finally {
      if (saved === undefined) delete process.env.VENDOR_BILLING_ENABLED
      else process.env.VENDOR_BILLING_ENABLED = saved
    }
  })

  it("reports a live promotion's expiry", async () => {
    // Relative to now, not a literal date: this was pinned to
    // 2026-09-01T00:00:00Z, which stopped being "live" the moment that
    // timestamp passed and turned the assertion into a scheduled CI failure.
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const { req } = makeReq({ hasPromotion: true, expiresAt: expires })
    const res = createRes()
    await VENDOR_GET(req as never, res as never)

    const promo = res.body.promotion as Record<string, unknown>
    expect(promo.active).toBe(true)
    expect((promo.expires_at as Date).getTime()).toBe(expires.getTime())
  })

  it("exposes no writer on the status route", () => {
    // Self-serve purchase lives at /vendor/promotion/purchase and grants only
    // once its charge is PAID. The status route itself must stay read-only —
    // a POST here would be a grant with no charge in front of it.
    expect(Object.keys(vendorPromotionRoute)).toEqual(["GET"])
  })
})
