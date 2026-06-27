import { emitSubscriptionState } from "../blackout-subscription"
import { emitBlackoutEvent } from "../blackout-emit"
import { resolveBlackoutUserId } from "../blackout-identity"

jest.mock("../blackout-emit", () => ({
  emitBlackoutEvent: jest.fn(),
}))
jest.mock("../blackout-identity", () => ({
  resolveBlackoutUserId: jest.fn(),
}))

const emitMock = emitBlackoutEvent as jest.MockedFunction<typeof emitBlackoutEvent>
const resolveMock = resolveBlackoutUserId as jest.MockedFunction<
  typeof resolveBlackoutUserId
>

const container = {} as any

describe("emitSubscriptionState — Blackout membership sync (§1/§3)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveMock.mockResolvedValue("blackout-user-123")
    emitMock.mockResolvedValue("evt_1")
  })

  it("maps an activating transition to subscription.activated with a stable eventId", async () => {
    const expiration = new Date("2026-07-27T00:00:00.000Z")
    const id = await emitSubscriptionState(
      container,
      {
        id: "sub_1",
        customer_id: "cus_1",
        metadata: { blackout_tier: "signal_plus" },
        expiration_date: expiration,
      },
      "subscribe"
    )

    expect(id).toBe("evt_1")
    expect(emitMock).toHaveBeenCalledTimes(1)
    const [, type, fields, opts] = emitMock.mock.calls[0]
    expect(type).toBe("subscription.activated")
    expect(fields).toMatchObject({
      userId: "blackout-user-123",
      tier: "signal_plus",
      subscriptionId: "sub_1",
      expiresAt: expiration.toISOString(),
    })
    expect(opts).toEqual({ eventId: "subscription.activated:sub_1:subscribe" })
  })

  it("maps a lapsing transition to subscription.lapsed without an expiresAt", async () => {
    await emitSubscriptionState(
      container,
      { id: "sub_2", customer_id: "cus_2", metadata: null },
      "cancel"
    )

    const [, type, fields, opts] = emitMock.mock.calls[0]
    expect(type).toBe("subscription.lapsed")
    expect(fields).not.toHaveProperty("expiresAt")
    expect(fields).toMatchObject({ subscriptionId: "sub_2", tier: "signal" })
    expect(opts).toEqual({ eventId: "subscription.lapsed:sub_2:cancel" })
  })

  it("keeps distinct eventIds per transition so a resubscribe after cancel still lands", async () => {
    await emitSubscriptionState(container, { id: "sub_3", customer_id: "c" }, "cancel")
    await emitSubscriptionState(container, { id: "sub_3", customer_id: "c" }, "subscribe")

    const ids = emitMock.mock.calls.map((c) => (c[3] as any).eventId)
    expect(new Set(ids).size).toBe(2)
  })

  it("skips (returns null, emits nothing) when the member has no linked Blackout account", async () => {
    resolveMock.mockResolvedValue(null)

    const id = await emitSubscriptionState(
      container,
      { id: "sub_4", customer_id: "cus_4" },
      "subscribe"
    )

    expect(id).toBeNull()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it("resolves identity from the member's customer id, never the seller", async () => {
    await emitSubscriptionState(
      container,
      { id: "sub_5", customer_id: "cus_5" },
      "resume"
    )

    expect(resolveMock).toHaveBeenCalledWith(container, { customerId: "cus_5" })
  })
})
