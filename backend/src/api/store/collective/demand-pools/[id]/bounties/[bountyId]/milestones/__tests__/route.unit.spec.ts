import { POST } from "../route"

jest.mock("../../../../../../../../../services/collective-hawala", () => ({
  getCollectiveHawalaService: jest.fn(),
}))
jest.mock("../../../../../../../../../lib/blackout-identity", () => ({
  resolveBlackoutUserId: jest.fn(),
}))
// Keep the real arg-builder so the settlement -> payload mapping is exercised;
// stub only the emit boundary.
jest.mock("../../../../../../../../../lib/blackout-stub-emitters", () => {
  const actual = jest.requireActual(
    "../../../../../../../../../lib/blackout-stub-emitters"
  )
  return { ...actual, emitQuestRewardSettled: jest.fn().mockResolvedValue("evt") }
})

import { getCollectiveHawalaService } from "../../../../../../../../../services/collective-hawala"
import { resolveBlackoutUserId } from "../../../../../../../../../lib/blackout-identity"
import { emitQuestRewardSettled } from "../../../../../../../../../lib/blackout-stub-emitters"

const settlementResult = {
  bounty_id: "bounty_1",
  milestone_index: 1,
  payout_amount: 12.5,
  total_paid_out: 12.5,
  new_status: "MILESTONE_PARTIAL",
  all_completed: false,
  ledger_entry_id: "entry_1",
}

const makeDemandPoolService = (overrides: Record<string, any> = {}) => ({
  listDemandPosts: jest.fn().mockResolvedValue([{ id: "dp_1", creator_id: "creator_1" }]),
  listDemandBounties: jest.fn().mockResolvedValue([
    {
      id: "bounty_1",
      assignee_id: "cust_9",
      assignee_type: "CUSTOMER",
      currency_code: "USD",
    },
  ]),
  ...overrides,
})

const makeReq = (demandPoolService: any) => ({
  params: { id: "dp_1", bountyId: "bounty_1" },
  body: { milestone_index: 1 },
  auth_context: { actor_id: "creator_1" },
  scope: { resolve: () => demandPoolService },
})

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

describe("bounty milestone payout route — quest.reward_settled wiring", () => {
  const completeAndPayMilestone = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    completeAndPayMilestone.mockResolvedValue(settlementResult)
    ;(getCollectiveHawalaService as jest.Mock).mockReturnValue({ completeAndPayMilestone })
    ;(resolveBlackoutUserId as jest.Mock).mockResolvedValue("bo_user_9")
  })

  it("emits quest.reward_settled with the settled milestone's real values", async () => {
    const res = createRes()
    await POST(makeReq(makeDemandPoolService()) as any, res as any)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(settlementResult)
    // Identity comes from the blackout-identity mapping for the assignee.
    expect(resolveBlackoutUserId).toHaveBeenCalledWith(expect.anything(), {
      customerId: "cust_9",
      sellerId: null,
    })
    expect(emitQuestRewardSettled).toHaveBeenCalledTimes(1)
    expect(emitQuestRewardSettled).toHaveBeenCalledWith(expect.anything(), {
      userId: "bo_user_9",
      grossCents: 1250,
      currency: "usd",
      fbmOrderId: "dp_1",
      questCompletionId: "bounty_1:m1",
      questId: "bounty_1",
    })
  })

  it("resolves SELLER assignees through the seller identity mapping", async () => {
    const service = makeDemandPoolService({
      listDemandBounties: jest.fn().mockResolvedValue([
        { id: "bounty_1", assignee_id: "seller_3", assignee_type: "SELLER", currency_code: "USD" },
      ]),
    })
    await POST(makeReq(service) as any, createRes() as any)

    expect(resolveBlackoutUserId).toHaveBeenCalledWith(expect.anything(), {
      customerId: null,
      sellerId: "seller_3",
    })
  })

  it("skips the emit (but still pays out) when no Blackout id is mapped", async () => {
    ;(resolveBlackoutUserId as jest.Mock).mockResolvedValue(null)
    const res = createRes()
    await POST(makeReq(makeDemandPoolService()) as any, res as any)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(settlementResult)
    expect(completeAndPayMilestone).toHaveBeenCalled()
    expect(emitQuestRewardSettled).not.toHaveBeenCalled()
  })

  it("never fails the payout response when the emit path throws", async () => {
    ;(resolveBlackoutUserId as jest.Mock).mockRejectedValue(new Error("identity down"))
    const res = createRes()
    await POST(makeReq(makeDemandPoolService()) as any, res as any)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(settlementResult)
  })

  it("does not emit when the milestone settlement itself fails", async () => {
    completeAndPayMilestone.mockRejectedValue(new Error("Milestone already completed"))
    const res = createRes()
    await POST(makeReq(makeDemandPoolService()) as any, res as any)

    expect(res.statusCode).toBe(400)
    expect(emitQuestRewardSettled).not.toHaveBeenCalled()
  })
})
