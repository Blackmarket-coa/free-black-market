import { GET, POST, SETTLEMENT_MODE_RETIRED } from "../settings/route"
import { DONATION_MODULE } from "../../../../modules/donation"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"

/**
 * S10: `POST /admin/donations/settings` refuses `settlement_mode: "ledger_batch"`
 * with a typed 409 naming `split_processor` while FF_NONPROFIT_PARITY_V1 is on.
 * `ledger_batch` is the custody-shaped mode (legal checkpoint L24); under the
 * flag donations are direct charges on the org's own account and nothing
 * executes `ledger_batch`. With the flag off the tier-2 gate is untouched.
 */
const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}
const createRes = (): TestRes => {
  const res = { statusCode: 200, body: {} } as TestRes
  res.status = (c) => ((res.statusCode = c), res)
  res.json = (p) => ((res.body = p as Record<string, unknown>), res)
  return res
}

type Req = Parameters<typeof POST>[0]
type Res = Parameters<typeof POST>[1]

function makeReq(body: Record<string, unknown>, context: Record<string, unknown> | null) {
  const service = {
    getOrCreateDefaultSettings: jest.fn(async () => ({ id: "ds_1", settlement_mode: "split_processor" })),
    upsertDefaultSettings: jest.fn(async (data: Record<string, unknown>) => ({ id: "ds_1", ...data })),
  }
  const resolved: string[] = []
  const req = {
    body,
    storefront_context: context,
    scope: {
      resolve: (key: string) => {
        resolved.push(key)
        if (key === DONATION_MODULE) return service
        throw new Error(`Could not resolve '${key}'`)
      },
    },
  } as unknown as Req
  return { req, service, resolved }
}

const tier2 = { tier: "tier2_aligned_org", gates: { advanced_automation: true } }

afterEach(() => {
  delete process.env[FLAG]
})

describe("POST /admin/donations/settings — ledger_batch under FF_NONPROFIT_PARITY_V1", () => {
  it("flag on: refuses ledger_batch with a typed 409 naming split_processor and writes nothing", async () => {
    process.env[FLAG] = "true"
    const { req, service } = makeReq({ settlement_mode: "ledger_batch" }, tier2)
    const res = createRes()
    await POST(req, res as unknown as Res)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      type: SETTLEMENT_MODE_RETIRED,
      message: expect.stringContaining("split_processor"),
      requested: "ledger_batch",
      allowed: ["split_processor"],
      flag: FLAG,
    })
    expect(service.upsertDefaultSettings).not.toHaveBeenCalled()
  })

  it("flag on: still accepts split_processor and the other fields", async () => {
    process.env[FLAG] = "true"
    const { req, service } = makeReq({ settlement_mode: "split_processor", default_percentage: 3 }, tier2)
    const res = createRes()
    await POST(req, res as unknown as Res)
    expect(res.statusCode).toBe(200)
    expect(service.upsertDefaultSettings).toHaveBeenCalledWith({ settlement_mode: "split_processor", default_percentage: 3 })
  })

  it("flag off: ledger_batch for a tier-2 storefront is accepted exactly as before", async () => {
    const { req, service } = makeReq({ settlement_mode: "ledger_batch" }, tier2)
    const res = createRes()
    await POST(req, res as unknown as Res)
    expect(res.statusCode).toBe(200)
    expect(service.upsertDefaultSettings).toHaveBeenCalledWith({ settlement_mode: "ledger_batch" })
  })

  it("flag off: ledger_batch without the tier-2 gate is still the 403 it was", async () => {
    const { req, service } = makeReq({ settlement_mode: "ledger_batch" }, { tier: "tier1_verified", gates: {} })
    const res = createRes()
    await POST(req, res as unknown as Res)
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ message: "ledger_batch mode requires tier2_aligned_org" })
    expect(service.upsertDefaultSettings).not.toHaveBeenCalled()
  })

  it("flag set to \"1\" is off", async () => {
    process.env[FLAG] = "1"
    const { req } = makeReq({ settlement_mode: "ledger_batch" }, tier2)
    const res = createRes()
    await POST(req, res as unknown as Res)
    expect(res.statusCode).toBe(200)
  })

  it("resolves the donation module by its imported key", async () => {
    const { req, resolved } = makeReq({ default_percentage: 2 }, tier2)
    await POST(req, createRes() as unknown as Res)
    expect(resolved).toEqual([DONATION_MODULE])
    const g = makeReq({}, tier2)
    await GET(g.req, createRes() as unknown as Res)
    expect(g.resolved).toEqual([DONATION_MODULE])
  })
})
