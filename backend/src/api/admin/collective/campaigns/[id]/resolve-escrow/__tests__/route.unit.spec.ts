import { POST } from "../route"
import {
  CampaignStatus,
  COLLECTIVE_CAMPAIGN_MODULE,
} from "../../../../../../../modules/collective-campaign"
import { HAWALA_LEDGER_MODULE } from "../../../../../../../modules/hawala-ledger"
import { CAMPAIGN_ESCROW_FLAG } from "../../../../../../../lib/campaign-escrow"

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

describe("admin collective campaigns [id] resolve-escrow route", () => {
  afterEach(() => {
    delete process.env[CAMPAIGN_ESCROW_FLAG]
  })

  const fundedCampaign = {
    id: "cc_1",
    vendor_id: "vendor_1",
    status: CampaignStatus.FUNDED,
    metadata: null,
  }
  const escrowedBackings = [
    {
      id: "b_1",
      backer_id: "cus_1",
      amount: 25,
      metadata: { escrow_ledger_entry_id: "le_1", escrow_amount_cents: 2500 },
    },
    {
      id: "b_2",
      backer_id: "cus_2",
      amount: 75,
      metadata: { escrow_ledger_entry_id: "le_2", escrow_amount_cents: 7500 },
    },
  ]

  it("is dark when the flag is off: 404 and no service resolution", async () => {
    const resolve = jest.fn()
    const req: any = { params: { id: "cc_1" }, body: {}, scope: { resolve } }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(404)
    expect(resolve).not.toHaveBeenCalled()
  })

  it("flag on: releases the escrowed total to the vendor with the fee carved out", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest.fn().mockResolvedValue([fundedCampaign]),
      listBackings: jest.fn().mockResolvedValue(escrowedBackings),
      updateBackings: jest.fn().mockResolvedValue(undefined),
      updateCampaigns: jest.fn().mockResolvedValue(undefined),
    }
    const hawala = {
      releaseCampaignEscrow: jest.fn().mockResolvedValue({
        release_entry: { id: "le_release" },
        fee_entry: { id: "le_fee" },
      }),
    }

    const req: any = {
      params: { id: "cc_1" },
      body: { platform_fee_cents: 300 },
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(200)
    expect(hawala.releaseCampaignEscrow).toHaveBeenCalledTimes(1)
    expect(hawala.releaseCampaignEscrow).toHaveBeenCalledWith({
      campaignId: "cc_1",
      vendorSellerId: "vendor_1",
      amountCents: 10000,
      platformFeeCents: 300,
    })
    expect(service.updateBackings).toHaveBeenCalledWith({ id: "b_1", status: "SETTLED" })
    expect(service.updateBackings).toHaveBeenCalledWith({ id: "b_2", status: "SETTLED" })
    expect(service.updateCampaigns).toHaveBeenCalledWith({
      id: "cc_1",
      metadata: expect.objectContaining({
        escrow_release_ledger_entry_id: "le_release",
        escrow_release_fee_ledger_entry_id: "le_fee",
      }),
    })
    expect(res.body).toEqual(
      expect.objectContaining({
        campaign_id: "cc_1",
        release_amount_cents: 9700,
        platform_fee_cents: 300,
        ledger_entries: { release_entry_id: "le_release", fee_entry_id: "le_fee" },
      })
    )
  })

  it("flag on: ledger failure maps to 402 escrow_failed and settles nothing", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest.fn().mockResolvedValue([fundedCampaign]),
      listBackings: jest.fn().mockResolvedValue(escrowedBackings),
      updateBackings: jest.fn(),
      updateCampaigns: jest.fn(),
    }
    const hawala = {
      releaseCampaignEscrow: jest
        .fn()
        .mockRejectedValue(new Error("Insufficient balance in account ESC-X")),
    }

    const req: any = {
      params: { id: "cc_1" },
      body: {},
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(402)
    expect(res.body.type).toBe("escrow_failed")
    expect(service.updateBackings).not.toHaveBeenCalled()
    expect(service.updateCampaigns).not.toHaveBeenCalled()
  })

  it("flag on: rejects campaigns that have not passed the all-or-nothing gate", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest
        .fn()
        .mockResolvedValue([{ ...fundedCampaign, status: CampaignStatus.ACTIVE }]),
      listBackings: jest.fn(),
    }
    const hawala = { releaseCampaignEscrow: jest.fn() }

    const req: any = {
      params: { id: "cc_1" },
      body: {},
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(400)
    expect(hawala.releaseCampaignEscrow).not.toHaveBeenCalled()
  })

  it("flag on: 400 when no funds were ever escrowed (all dark-era pledges)", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest.fn().mockResolvedValue([fundedCampaign]),
      listBackings: jest
        .fn()
        .mockResolvedValue([{ id: "b_dark", backer_id: "cus_1", amount: 10, metadata: null }]),
    }
    const hawala = { releaseCampaignEscrow: jest.fn() }

    const req: any = {
      params: { id: "cc_1" },
      body: {},
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(400)
    expect(hawala.releaseCampaignEscrow).not.toHaveBeenCalled()
  })
})
