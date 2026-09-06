import { GET, POST } from "../route"
import { DONATION_MODULE } from "../../../../../modules/donation"

/**
 * Donation checkout settings are one platform-wide row. Until 2026-09-06 the
 * vendor route's POST upserted it behind seller-only auth, so any seller
 * could change the platform's donation percentage and settlement mode
 * (`docs/CDFI_COOP_ROADMAP.md` §1a). Vendors read; only the admin route writes.
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

type GetArgs = Parameters<typeof GET>
type PostArgs = Parameters<typeof POST>

const makeReq = (service: unknown, body?: Record<string, unknown>) => ({
  body,
  auth_context: { actor_id: "sel_1" },
  scope: {
    resolve: jest.fn((key: string) => (key === DONATION_MODULE ? service : undefined)),
  },
})

describe("/vendor/donations/settings", () => {
  it("GET returns the platform default settings", async () => {
    const settings = { id: "ds_1", default_percentage: 2, round_up_enabled: true }
    const service = { getOrCreateDefaultSettings: jest.fn().mockResolvedValue(settings) }
    const res = createRes()

    await GET(makeReq(service) as unknown as GetArgs[0], res as unknown as GetArgs[1])

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ settings })
  })

  it("POST is refused and never touches the donation module", async () => {
    const service = { upsertDefaultSettings: jest.fn(), getOrCreateDefaultSettings: jest.fn() }
    const req = makeReq(service, { default_percentage: 50, settlement_mode: "ledger_batch" })
    const res = createRes()

    await POST(req as unknown as PostArgs[0], res as unknown as PostArgs[1])

    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ code: "DONATION_SETTINGS_PLATFORM_SCOPED" })
    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(service.upsertDefaultSettings).not.toHaveBeenCalled()
  })
})
