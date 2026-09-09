import { POST } from "../route"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../../../../../modules/collective-campaign"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import {
  CAMPAIGN_ESCROW_FLAG,
  SECURITIES_GATE_FLAG,
} from "../../../../../../../lib/campaign-escrow"

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

const makeScope = (map: Record<string, any>) => ({
  resolve: (key: string) => {
    if (key in map) {
      return map[key]
    }
    throw new Error(`unresolvable: ${key}`)
  },
})

const makeDeps = () => {
  const service = {
    addBacking: jest.fn().mockResolvedValue({ id: "b_1" }),
    listCampaigns: jest.fn(),
  }
  const hawala = {
    openCampaignBackingEscrow: jest.fn(),
    refundCampaignBackingEscrow: jest.fn(),
  }
  return { service, hawala }
}

const makeReq = (mode: string, deps: ReturnType<typeof makeDeps>) => ({
  params: { id: "cc_1" },
  auth_context: { actor_id: "backer_1" },
  body: { mode, amount: 10 },
  scope: makeScope({
    [COLLECTIVE_CAMPAIGN_MODULE]: deps.service,
    [HAWALA_LEDGER_MODULE]: deps.hawala,
  }),
})

/**
 * REPO_CONSOLIDATION_REVIEW.md §8 gates revenue-share cash-in behind the Reg CF
 * work: "These are hard release gates, not configuration toggles." Before
 * 2026-09-09 `FBM_CAMPAIGN_ESCROW_LIVE` — a configuration toggle — moved money
 * for a MICRO_INVESTOR backing exactly as it did for a PRE_ORDER one.
 * See docs/TRANSMUTATION_STRATEGY.md §3.2, §7.1.
 */
describe("store collective campaign backings route (securities gate)", () => {
  afterEach(() => {
    delete process.env[CAMPAIGN_ESCROW_FLAG]
    delete process.env[SECURITIES_GATE_FLAG]
  })

  it("refuses a MICRO_INVESTOR backing with 403 and writes nothing", async () => {
    const deps = makeDeps()
    const res = createRes()

    await POST(makeReq("MICRO_INVESTOR", deps) as any, res)

    expect(res.statusCode).toBe(403)
    expect(deps.service.addBacking).not.toHaveBeenCalled()
    expect(deps.hawala.openCampaignBackingEscrow).not.toHaveBeenCalled()
  })

  it("stays refused when the escrow mechanism flag is set", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"
    const deps = makeDeps()
    const res = createRes()

    await POST(makeReq("MICRO_INVESTOR", deps) as any, res)

    expect(res.statusCode).toBe(403)
    expect(deps.hawala.openCampaignBackingEscrow).not.toHaveBeenCalled()
    // The campaign is never even read: the gate runs before any lookup.
    expect(deps.service.listCampaigns).not.toHaveBeenCalled()
  })

  it("allows a MICRO_INVESTOR backing once the gate is cleared", async () => {
    process.env[SECURITIES_GATE_FLAG] = "1"
    const deps = makeDeps()
    const res = createRes()

    await POST(makeReq("MICRO_INVESTOR", deps) as any, res)

    expect(res.statusCode).toBe(201)
    expect(deps.service.addBacking).toHaveBeenCalled()
  })

  it("never affects a PRE_ORDER backing", async () => {
    const deps = makeDeps()
    const res = createRes()

    await POST(makeReq("PRE_ORDER", deps) as any, res)

    expect(res.statusCode).toBe(201)
    expect(deps.service.addBacking).toHaveBeenCalled()
  })
})
