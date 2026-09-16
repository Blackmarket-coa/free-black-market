import { POST } from "../route"

/**
 * Coalition reputation ingest.
 *
 * The property worth pinning is not that it awards — it is that the CALLER
 * cannot choose the award. Blackout says what happened; the delta table here
 * says what it is worth. A caller that could send an amount could mint
 * reputation, and reputation is what the ladder is made of.
 *
 * Also pinned: deltas are flat, so nothing in the payload can make an event
 * worth more. Reputation and capital stay structurally separate — an award
 * that scaled with dollars would be a rebate, which needs legal review before
 * it ships rather than after.
 */

jest.mock("../../../../../../../lib/blackout-entitlements-auth", () => ({
  requireEntitlementsAuth: jest.fn(() => true),
}))

const resolveCustomer = jest.fn(async () => ({ customerId: "cus_1", created: false }))
jest.mock("../../../../../../../lib/blackout-identity", () => ({
  resolveOrCreateCustomerForBlackoutUser: (...args: unknown[]) => resolveCustomer(...(args as [])),
}))

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: Record<string, unknown>) {
      res.body = payload
      return res
    },
  }
  return res
}

const recordXpEvent = jest.fn(async (..._args: unknown[]) => ({ id: "xp_1" }))

const makeReq = (body: Record<string, unknown>) =>
  ({
    body,
    headers: {},
    scope: { resolve: () => ({ recordXpEvent }) },
  }) as never

beforeEach(() => {
  recordXpEvent.mockClear()
  resolveCustomer.mockClear()
  resolveCustomer.mockResolvedValue({ customerId: "cus_1", created: false })
})

const validBody = {
  blackoutUserId: "usr_1",
  eventType: "drive_completed",
  referenceId: "camp_1",
  coalitionId: "coa_1",
}

describe("POST /v1/integrations/blackout/reputation/events", () => {
  it("chooses the delta itself and ignores anything the caller sends", async () => {
    const res = makeRes()
    // `amount` is not in the schema at all; a strict schema rejects it rather
    // than quietly dropping it, which is the louder and safer failure.
    await POST(makeReq({ ...validBody, amount: 10_000 }), res as never)
    expect(res.statusCode).toBe(400)
    expect(recordXpEvent).not.toHaveBeenCalled()
  })

  it("awards the table's flat delta for a known event", async () => {
    const res = makeRes()
    await POST(makeReq(validBody), res as never)
    expect(res.statusCode).toBe(202)
    expect(recordXpEvent).toHaveBeenCalledTimes(1)
    const call = recordXpEvent.mock.calls[0][0] as Record<string, unknown>
    expect(call.amount).toBe(25)
    expect(call.customer_id).toBe("cus_1")
    expect(call.source_module).toBe("blackout_coalition")
    expect(call.source_id).toBe("drive_completed:camp_1")
  })

  it("awards the same delta regardless of how much money the drive moved", async () => {
    // There is nowhere in the payload to say — which is the guarantee.
    const first = makeRes()
    await POST(makeReq({ ...validBody, referenceId: "camp_small" }), first as never)
    const second = makeRes()
    await POST(makeReq({ ...validBody, referenceId: "camp_huge" }), second as never)
    const amounts = recordXpEvent.mock.calls.map((c) => (c[0] as { amount: number }).amount)
    expect(amounts).toEqual([25, 25])
  })

  it("refuses an unknown event type rather than guessing a value", async () => {
    const res = makeRes()
    await POST(makeReq({ ...validBody, eventType: "mined_karma" }), res as never)
    expect(res.statusCode).toBe(400)
    expect(res.body?.code).toBe("unknown_event_type")
    expect(recordXpEvent).not.toHaveBeenCalled()
  })

  it("says so plainly when there is no FBM identity to award", async () => {
    resolveCustomer.mockResolvedValue({ customerId: "", created: false })
    const res = makeRes()
    await POST(makeReq(validBody), res as never)
    expect(res.statusCode).toBe(404)
    expect(res.body?.code).toBe("identity_unresolved")
    expect(recordXpEvent).not.toHaveBeenCalled()
  })

  it("reports a failed award instead of throwing into Blackout's flow", async () => {
    recordXpEvent.mockRejectedValueOnce(new Error("ladder unavailable"))
    const res = makeRes()
    await POST(makeReq(validBody), res as never)
    expect(res.statusCode).toBe(502)
    expect(res.body?.code).toBe("award_failed")
  })

  it("derives a deterministic replay key from the event and its reference", async () => {
    const res = makeRes()
    await POST(makeReq({ ...validBody, eventType: "member_joined", referenceId: "mem_9" }), res as never)
    expect((recordXpEvent.mock.calls[0][0] as { source_id: string }).source_id).toBe(
      "member_joined:mem_9"
    )
  })
})
