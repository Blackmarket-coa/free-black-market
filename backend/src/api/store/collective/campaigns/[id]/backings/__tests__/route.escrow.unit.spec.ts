import { POST } from "../route"
import {
  COLLECTIVE_CAMPAIGN_MODULE,
  CampaignStatus,
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

describe("store collective campaign backings route (escrow)", () => {
  afterEach(() => {
    delete process.env[CAMPAIGN_ESCROW_FLAG]
  })

  it("flag off: creates the backing with no ledger calls and unchanged input", async () => {
    const service = {
      addBacking: jest.fn().mockResolvedValue({ id: "b_1" }),
      listCampaigns: jest.fn(),
    }
    const hawala = {
      openCampaignBackingEscrow: jest.fn(),
      refundCampaignBackingEscrow: jest.fn(),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "backer_1" },
      body: { mode: "PRE_ORDER", amount: 10, metadata: { note: "hi" } },
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(201)
    expect(hawala.openCampaignBackingEscrow).not.toHaveBeenCalled()
    expect(hawala.refundCampaignBackingEscrow).not.toHaveBeenCalled()
    expect(service.listCampaigns).not.toHaveBeenCalled()
    expect(service.addBacking).toHaveBeenCalledWith({
      campaign_id: "cc_1",
      backer_id: "backer_1",
      mode: "PRE_ORDER",
      amount: 10,
      units_reserved: undefined,
      metadata: { note: "hi" },
    })
  })

  it("flag on: escrows the converted cents before persisting and links the entry in metadata", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest
        .fn()
        .mockResolvedValue([{ id: "cc_1", status: CampaignStatus.ACTIVE }]),
      addBacking: jest.fn().mockResolvedValue({ id: "b_1" }),
    }
    const hawala = {
      openCampaignBackingEscrow: jest.fn().mockResolvedValue({ id: "le_escrow" }),
      refundCampaignBackingEscrow: jest.fn(),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "backer_1" },
      body: { mode: "PRE_ORDER", amount: 10.5 },
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(201)
    expect(hawala.openCampaignBackingEscrow).toHaveBeenCalledTimes(1)
    const escrowArgs = hawala.openCampaignBackingEscrow.mock.calls[0][0]
    expect(escrowArgs).toEqual({
      campaignId: "cc_1",
      backingId: expect.stringMatching(/^cbck_/),
      backerCustomerId: "backer_1",
      // amount is major units (10.50) -> 1050 cents at the boundary
      amountCents: 1050,
    })

    // Escrow strictly precedes persistence, and the persisted backing carries
    // the pre-minted id plus the ledger linkage in metadata.
    expect(hawala.openCampaignBackingEscrow.mock.invocationCallOrder[0]).toBeLessThan(
      service.addBacking.mock.invocationCallOrder[0]
    )
    expect(service.addBacking).toHaveBeenCalledWith(
      expect.objectContaining({
        id: escrowArgs.backingId,
        campaign_id: "cc_1",
        backer_id: "backer_1",
        amount: 10.5,
        metadata: {
          escrow_ledger_entry_id: "le_escrow",
          escrow_amount_cents: 1050,
        },
      })
    )
  })

  it("flag on: ledger failure returns 402 and no backing is created", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest
        .fn()
        .mockResolvedValue([{ id: "cc_1", status: CampaignStatus.ACTIVE }]),
      addBacking: jest.fn(),
    }
    const hawala = {
      openCampaignBackingEscrow: jest
        .fn()
        .mockRejectedValue(new Error("Insufficient balance in account USR-X")),
      refundCampaignBackingEscrow: jest.fn(),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "backer_1" },
      body: { mode: "PRE_ORDER", amount: 10 },
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(402)
    expect(res.body.error).toContain("Escrow operation failed")
    expect(service.addBacking).not.toHaveBeenCalled()
  })

  it("flag on: rejects non-ACTIVE campaigns before any money moves", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest
        .fn()
        .mockResolvedValue([{ id: "cc_1", status: CampaignStatus.FUNDED }]),
      addBacking: jest.fn(),
    }
    const hawala = { openCampaignBackingEscrow: jest.fn() }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "backer_1" },
      body: { mode: "PRE_ORDER", amount: 10 },
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(400)
    expect(hawala.openCampaignBackingEscrow).not.toHaveBeenCalled()
    expect(service.addBacking).not.toHaveBeenCalled()
  })

  it("flag on: refunds the escrow when persisting the backing fails", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest
        .fn()
        .mockResolvedValue([{ id: "cc_1", status: CampaignStatus.ACTIVE }]),
      addBacking: jest.fn().mockRejectedValue(new Error("insert failed")),
    }
    const hawala = {
      openCampaignBackingEscrow: jest.fn().mockResolvedValue({ id: "le_escrow" }),
      refundCampaignBackingEscrow: jest.fn().mockResolvedValue({ id: "le_refund" }),
    }

    const req: any = {
      params: { id: "cc_1" },
      auth_context: { actor_id: "backer_1" },
      body: { mode: "PRE_ORDER", amount: 10 },
      scope: makeScope({
        [COLLECTIVE_CAMPAIGN_MODULE]: service,
        [HAWALA_LEDGER_MODULE]: hawala,
      }),
    }

    const res = createRes()
    await POST(req, res)

    expect(res.statusCode).toBe(400)
    expect(hawala.refundCampaignBackingEscrow).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "cc_1",
        backerCustomerId: "backer_1",
        amountCents: 1000,
        reason: "backing creation failed",
      })
    )
  })
})
