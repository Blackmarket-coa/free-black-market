import {
  emitSubscriptionPaymentFailed,
  emitSubscriptionState,
} from "../blackout-subscription"
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

describe("emitSubscriptionPaymentFailed — dunning bridge (W1b)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveMock.mockResolvedValue("blackout-user-123")
    emitMock.mockResolvedValue("evt_pf")
  })

  const subscription = {
    id: "sub_7",
    customer_id: "cus_7",
    metadata: { blackout_tier: "coalition" },
  }

  it("emits subscription.payment_failed with per-attempt eventId and occurredAt", async () => {
    const id = await emitSubscriptionPaymentFailed(container, subscription, {
      attempts: 2,
      paused: false,
      nextRetryAt: new Date("2026-09-02T00:00:00.000Z"),
    })

    expect(id).toBe("evt_pf")
    const [, type, fields, opts] = emitMock.mock.calls[0]
    expect(type).toBe("subscription.payment_failed")
    expect(fields).toMatchObject({
      userId: "blackout-user-123",
      tier: "signal_plus", // coalition → wire alias
      subscriptionId: "sub_7",
      attempt: 2,
      willRetry: true,
      nextRetryAt: "2026-09-02T00:00:00.000Z",
    })
    expect(typeof (fields as { occurredAt?: unknown }).occurredAt).toBe("string")
    expect(opts).toEqual({ eventId: "subscription.payment_failed:sub_7:2" })
  })

  it("marks willRetry=false once dunning paused the subscription", async () => {
    await emitSubscriptionPaymentFailed(container, subscription, {
      attempts: 3,
      paused: true,
    })
    const [, , fields] = emitMock.mock.calls[0]
    expect(fields).toMatchObject({ attempt: 3, willRetry: false })
  })

  it("skips (returns null) for members with no linked Blackout account", async () => {
    resolveMock.mockResolvedValue(null)
    const id = await emitSubscriptionPaymentFailed(container, subscription, {
      attempts: 1,
    })
    expect(id).toBeNull()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it("stamps occurredAt on lifecycle state events too (ordering hint)", async () => {
    await emitSubscriptionState(
      container,
      { id: "sub_1", customer_id: "cus_1", metadata: {} },
      "cancel"
    )
    const [, type, fields] = emitMock.mock.calls[0]
    expect(type).toBe("subscription.lapsed")
    expect(typeof (fields as { occurredAt?: unknown }).occurredAt).toBe("string")
  })
})
