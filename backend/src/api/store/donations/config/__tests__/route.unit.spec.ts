import { GET } from "../route"
import { DONATION_MODULE } from "../../../../../modules/donation"
import { TENANCY_MODULE } from "../../../../../modules/tenancy"

/**
 * `GET /store/donations/config` tells the checkout widget whether the fiscal
 * sponsor is live. Every registry entry is `live: false` until the agreement
 * in `docs/FISCAL_SPONSOR_DECISION.md` is signed; until 2026-09-06 the widget
 * had no way to know and told donors their gift was routed through a
 * 501(c)(3). The ledger account id must never reach the storefront.
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

type RouteArgs = Parameters<typeof GET>

const makeReq = () => {
  const donation = {
    getOrCreateDefaultSettings: jest.fn(async () => ({
      id: "ds_1",
      default_percentage: 2,
      round_up_enabled: true,
      fiscal_sponsor_name: "Allied Media Projects",
      fiscal_sponsor_url: "https://alliedmedia.org",
      fiscal_sponsor_account_id: "ledger_amp_pending",
      settlement_mode: "split_processor",
    })),
  }
  const tenancy = {
    resolveContext: jest.fn(async () => ({ tier: "tier1_member" })),
    featureGatesForTier: jest.fn(() => ({ donation_routing: true, advanced_automation: false })),
  }
  return {
    headers: {},
    scope: {
      resolve: (key: string) =>
        key === DONATION_MODULE ? donation : key === TENANCY_MODULE ? tenancy : undefined,
    },
  }
}

describe("GET /store/donations/config — fiscal sponsor liveness", () => {
  const ENV_KEYS = ["FBM_FISCAL_SPONSOR_LIVE", "FBM_FISCAL_SPONSOR_PROVIDER"]
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it("reports the sponsor as pending by default and never leaks the ledger account", async () => {
    const res = createRes()
    await GET(makeReq() as unknown as RouteArgs[0], res as unknown as RouteArgs[1])

    expect(res.statusCode).toBe(200)
    const body = res.body as { settings: Record<string, unknown> }
    expect(body.settings).toEqual({
      default_percentage: 2,
      round_up_enabled: true,
      fiscal_sponsor_name: "Allied Media Projects",
      fiscal_sponsor_url: "https://alliedmedia.org",
      fiscal_sponsor_live: false,
    })
    expect(body.settings).not.toHaveProperty("fiscal_sponsor_account_id")
    expect(body.settings).not.toHaveProperty("settlement_mode")
  })

  it("reports live only when the deploy flips the sponsor live", async () => {
    process.env.FBM_FISCAL_SPONSOR_LIVE = "true"
    const res = createRes()
    await GET(makeReq() as unknown as RouteArgs[0], res as unknown as RouteArgs[1])

    expect((res.body as { settings: { fiscal_sponsor_live: boolean } }).settings.fiscal_sponsor_live).toBe(true)
  })
})
