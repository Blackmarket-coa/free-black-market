import { PATCH } from "../route"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../../../../modules/collective-campaign"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import { CAMPAIGN_ESCROW_FLAG } from "../../../../../../lib/campaign-escrow"

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

const makeRequest = (scope: any): any => ({
  params: { id: "cc_1" },
  auth_context: { actor_id: "vendor_1" },
  body: { action: "mark-failed" },
  scope,
})

describe("store collective campaigns [id] route mark-failed (escrow)", () => {
  afterEach(() => {
    delete process.env[CAMPAIGN_ESCROW_FLAG]
  })

  it("flag off: marks failed with no ledger calls (unchanged behavior)", async () => {
    const service = {
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", vendor_id: "vendor_1" }]),
      markCampaignFailed: jest
        .fn()
        .mockResolvedValue({ campaign_id: "cc_1", refunded_backings: 2 }),
      listBackings: jest.fn(),
    }
    const hawala = { refundCampaignBackingEscrow: jest.fn() }

    const res = createRes()
    await PATCH(
      makeRequest(
        makeScope({ [COLLECTIVE_CAMPAIGN_MODULE]: service, [HAWALA_LEDGER_MODULE]: hawala })
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ campaign_id: "cc_1", refunded_backings: 2 })
    expect(hawala.refundCampaignBackingEscrow).not.toHaveBeenCalled()
    expect(service.listBackings).not.toHaveBeenCalled()
    expect(service.markCampaignFailed).toHaveBeenCalledWith("cc_1")
  })

  it("flag on: refunds each escrowed PLEDGED backing exactly once, then flips statuses", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const pledged = [
      {
        id: "b_1",
        backer_id: "cus_1",
        amount: 25,
        metadata: { escrow_ledger_entry_id: "le_1", escrow_amount_cents: 2500 },
      },
      {
        id: "b_2",
        backer_id: "cus_2",
        amount: 75.5,
        metadata: { escrow_ledger_entry_id: "le_2", escrow_amount_cents: 7550 },
      },
      // Backed while escrow was dark: no ledger entry, must not be refunded.
      { id: "b_dark", backer_id: "cus_3", amount: 10, metadata: null },
    ]
    const service = {
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", vendor_id: "vendor_1" }]),
      listBackings: jest.fn().mockResolvedValue(pledged),
      updateBackings: jest.fn().mockResolvedValue(undefined),
      markCampaignFailed: jest
        .fn()
        .mockResolvedValue({ campaign_id: "cc_1", refunded_backings: 3 }),
    }
    const hawala = {
      refundCampaignBackingEscrow: jest
        .fn()
        .mockImplementation(async ({ backingId }: { backingId: string }) => ({
          id: `refund_${backingId}`,
        })),
    }

    const res = createRes()
    await PATCH(
      makeRequest(
        makeScope({ [COLLECTIVE_CAMPAIGN_MODULE]: service, [HAWALA_LEDGER_MODULE]: hawala })
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(service.listBackings).toHaveBeenCalledWith({ campaign_id: "cc_1", status: "PLEDGED" })
    expect(hawala.refundCampaignBackingEscrow).toHaveBeenCalledTimes(2)
    expect(hawala.refundCampaignBackingEscrow).toHaveBeenCalledWith({
      campaignId: "cc_1",
      backingId: "b_1",
      backerCustomerId: "cus_1",
      amountCents: 2500,
      reason: "campaign failed",
    })
    expect(hawala.refundCampaignBackingEscrow).toHaveBeenCalledWith({
      campaignId: "cc_1",
      backingId: "b_2",
      backerCustomerId: "cus_2",
      amountCents: 7550,
      reason: "campaign failed",
    })
    // Refund entry ids are linked back onto the backings.
    expect(service.updateBackings).toHaveBeenCalledWith({
      id: "b_1",
      metadata: expect.objectContaining({ refund_ledger_entry_id: "refund_b_1" }),
    })
    expect(service.markCampaignFailed).toHaveBeenCalledTimes(1)
    expect(res.body.refund_ledger_entries).toEqual([
      { backing_id: "b_1", entry_id: "refund_b_1", amount_cents: 2500 },
      { backing_id: "b_2", entry_id: "refund_b_2", amount_cents: 7550 },
    ])
  })

  it("flag on: ledger failure returns 402 and statuses are not flipped", async () => {
    process.env[CAMPAIGN_ESCROW_FLAG] = "1"

    const service = {
      listCampaigns: jest.fn().mockResolvedValue([{ id: "cc_1", vendor_id: "vendor_1" }]),
      listBackings: jest.fn().mockResolvedValue([
        {
          id: "b_1",
          backer_id: "cus_1",
          amount: 25,
          metadata: { escrow_ledger_entry_id: "le_1", escrow_amount_cents: 2500 },
        },
      ]),
      updateBackings: jest.fn(),
      markCampaignFailed: jest.fn(),
    }
    const hawala = {
      refundCampaignBackingEscrow: jest
        .fn()
        .mockRejectedValue(new Error("Insufficient balance in account ESC-X")),
    }

    const res = createRes()
    await PATCH(
      makeRequest(
        makeScope({ [COLLECTIVE_CAMPAIGN_MODULE]: service, [HAWALA_LEDGER_MODULE]: hawala })
      ),
      res
    )

    expect(res.statusCode).toBe(402)
    expect(res.body.error).toContain("Escrow operation failed")
    expect(service.markCampaignFailed).not.toHaveBeenCalled()
    expect(service.updateBackings).not.toHaveBeenCalled()
  })
})
