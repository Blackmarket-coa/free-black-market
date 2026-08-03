import { GET, POST } from "../[id]/payout-settings/route"
import { PAYOUT_BREAKDOWN_MODULE } from "../../../../modules/payout-breakdown"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import { clearPlanFeatureCache } from "../../../../shared/plan-entitlement-cache"
import { getPlanDefinition } from "../../../../modules/vendor-plan/catalog"

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

type Settings = {
  custom_platform_fee_percent?: number | null
  fee_reduction_reason?: string | null
  fee_reduction_expires_at?: Date | null
} | null

const makeReq = (opts: {
  sellerId?: string
  body?: unknown
  planCode?: string
  settings?: Settings
  detail?: { percent: number; source: string }
}) => {
  let settings: Settings = opts.settings ?? null

  const upsertSellerSettings = jest.fn(
    async (_id: string, updates: Record<string, unknown>) => {
      settings = { ...(settings ?? {}), ...updates } as Settings
      return settings
    }
  )
  const clearSellerFeeOverride = jest.fn(async () => {
    settings = {
      custom_platform_fee_percent: null,
      fee_reduction_reason: null,
      fee_reduction_expires_at: null,
    }
    return settings
  })

  const payouts = {
    getSellerSettings: async () => settings,
    upsertSellerSettings,
    clearSellerFeeOverride,
    getPlatformFeeDetail: async (_s: string, planPercent: number | null) => {
      const override = settings?.custom_platform_fee_percent
      if (typeof override === "number") {
        return {
          percent: override,
          source: "seller_override",
          override_expired: false,
          override_reason: settings?.fee_reduction_reason ?? null,
        }
      }
      if (typeof planPercent === "number") {
        return {
          percent: planPercent,
          source: "plan",
          override_expired: false,
          override_reason: null,
        }
      }
      return {
        percent: 3,
        source: "platform_default",
        override_expired: false,
        override_reason: null,
      }
    },
  }

  return {
    req: {
      params: { id: opts.sellerId === undefined ? "sel_1" : opts.sellerId },
      body: opts.body,
      scope: {
        resolve: (key: string) => {
          if (key === PAYOUT_BREAKDOWN_MODULE) return payouts
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
    upsertSellerSettings,
    clearSellerFeeOverride,
  }
}

beforeEach(() => {
  clearPlanFeatureCache()
})

describe("GET /admin/sellers/:id/payout-settings", () => {
  it("reports which source the effective rate came from", async () => {
    // The point of the endpoint: an operator setting a rate must see which of
    // the three sources actually won. With no override, a seller on `free`
    // resolves through the plan — the ladder pins `free` to the platform
    // default, so the number is unchanged but the provenance is now the plan.
    const { req } = makeReq({})
    const res = createRes()
    await GET(req as never, res as never)

    expect(res.statusCode).toBe(200)
    const effective = res.body.effective as Record<string, unknown>
    expect(effective.source).toBe("plan")
    expect(effective.percent).toBe(
      getPlanDefinition("free")?.platform_fee_percent
    )
    expect(res.body.override).toBeNull()
  })

  it("falls through to the platform default for a plan with no rate", async () => {
    // `internal` expresses no opinion, so the chain runs past it.
    const { req } = makeReq({ planCode: "internal" })
    const res = createRes()
    await GET(req as never, res as never)

    expect((res.body.effective as Record<string, unknown>).source).toBe(
      "platform_default"
    )
  })

  it("shows an existing override alongside the plan", async () => {
    const { req } = makeReq({
      settings: { custom_platform_fee_percent: 1.5, fee_reduction_reason: "pilot" },
    })
    const res = createRes()
    await GET(req as never, res as never)

    expect((res.body.effective as Record<string, unknown>).percent).toBe(1.5)
    expect((res.body.override as Record<string, unknown>).reason).toBe("pilot")
    expect((res.body.plan as Record<string, unknown>).code).toBe("free")
  })

  it("requires a seller id", async () => {
    const { req } = makeReq({ sellerId: "" })
    const res = createRes()
    await GET(req as never, res as never)
    expect(res.statusCode).toBe(400)
  })
})

describe("POST /admin/sellers/:id/payout-settings", () => {
  it("writes the override that previously had no writer", async () => {
    const { req, upsertSellerSettings } = makeReq({
      body: { custom_platform_fee_percent: 1.5, reason: "founding vendor" },
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(upsertSellerSettings).toHaveBeenCalledWith(
      "sel_1",
      expect.objectContaining({
        custom_platform_fee_percent: 1.5,
        fee_reduction_reason: "founding vendor",
      })
    )
    expect((res.body.effective as Record<string, unknown>).source).toBe(
      "seller_override"
    )
  })

  it("clears the override on an explicit null", async () => {
    const { req, clearSellerFeeOverride } = makeReq({
      body: { custom_platform_fee_percent: null },
      settings: { custom_platform_fee_percent: 1 },
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(clearSellerFeeOverride).toHaveBeenCalledWith("sel_1")
    expect(res.statusCode).toBe(200)
  })

  it("accepts zero as a real concession", async () => {
    const { req, upsertSellerSettings, clearSellerFeeOverride } = makeReq({
      body: { custom_platform_fee_percent: 0 },
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(clearSellerFeeOverride).not.toHaveBeenCalled()
    expect(upsertSellerSettings).toHaveBeenCalledWith(
      "sel_1",
      expect.objectContaining({ custom_platform_fee_percent: 0 })
    )
  })

  it("rejects a negative rate", async () => {
    // Would pay the seller more than the customer paid.
    const { req, upsertSellerSettings } = makeReq({
      body: { custom_platform_fee_percent: -1 },
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(upsertSellerSettings).not.toHaveBeenCalled()
  })

  it("rejects a rate above 100", async () => {
    const { req } = makeReq({ body: { custom_platform_fee_percent: 101 } })
    const res = createRes()
    await POST(req as never, res as never)
    expect(res.statusCode).toBe(400)
  })

  it("rejects a non-numeric rate", async () => {
    const { req } = makeReq({ body: { custom_platform_fee_percent: "2" } })
    const res = createRes()
    await POST(req as never, res as never)
    expect(res.statusCode).toBe(400)
  })

  it("requires the field, so an empty body cannot silently clear a rate", async () => {
    const { req, upsertSellerSettings, clearSellerFeeOverride } = makeReq({
      body: { reason: "typo fix" },
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(upsertSellerSettings).not.toHaveBeenCalled()
    expect(clearSellerFeeOverride).not.toHaveBeenCalled()
  })

  it("rejects an unparseable expiry", async () => {
    const { req } = makeReq({
      body: { custom_platform_fee_percent: 2, expires_at: "whenever" },
    })
    const res = createRes()
    await POST(req as never, res as never)
    expect(res.statusCode).toBe(400)
  })

  it("stores a valid expiry", async () => {
    const { req, upsertSellerSettings } = makeReq({
      body: { custom_platform_fee_percent: 2, expires_at: "2027-01-01T00:00:00Z" },
    })
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(200)
    const args = upsertSellerSettings.mock.calls[0][1] as Record<string, unknown>
    expect(args.fee_reduction_expires_at).toBeInstanceOf(Date)
  })
})
