import SubscriptionModuleService from "../service"
import { SubscriptionInterval, SubscriptionStatus } from "../types"
import { isSubscriptionTransitionError, SubscriptionTransitionError } from "../errors"
import { makeSubscriptionService, type FakeRow } from "./fake-subscription-service"

/**
 * The service-layer guards and the F4 lifecycle methods, run from the real
 * `SubscriptionModuleService` prototype over an in-memory store.
 */

const DAY = 24 * 60 * 60 * 1000

const row = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "sub_1",
  status: SubscriptionStatus.ACTIVE,
  interval: SubscriptionInterval.MONTHLY,
  period: 12,
  customer_id: "cus_1",
  product_id: "prod_1",
  seller_id: "sel_1",
  last_order_date: new Date("2026-09-01T00:00:00.000Z"),
  next_order_date: new Date("2026-10-01T00:00:00.000Z"),
  expiration_date: new Date("2027-09-01T00:00:00.000Z"),
  paused_at: null,
  canceled_at: null,
  grace_ends_at: null,
  grace_period_days: null,
  read_only_at: null,
  metadata: { initial_order_id: "order_0", blackout_tier: "gold" },
  ...overrides,
})

describe("A3 — resumeSubscription only from PAUSED (unconditional)", () => {
  it("resumes a paused subscription", async () => {
    const svc = makeSubscriptionService([row({ status: SubscriptionStatus.PAUSED })])
    const out = await svc.resumeSubscription("sub_1")
    expect(out.status).toBe(SubscriptionStatus.ACTIVE)
    expect(out.paused_at).toBeNull()
  })

  it.each([
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.EXPIRED,
    SubscriptionStatus.FAILED,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.READ_ONLY,
  ])("refuses to resume from %s with a typed error and writes nothing", async (status) => {
    const svc = makeSubscriptionService([row({ status })])
    const err = await svc.resumeSubscription("sub_1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SubscriptionTransitionError)
    expect(isSubscriptionTransitionError(err)).toBe(true)
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
    expect(svc.store.get("sub_1")?.status).toBe(status)
  })

  it("closes the cancel → pause → resume detour: pause is refused off ACTIVE", async () => {
    const svc = makeSubscriptionService([row({ status: SubscriptionStatus.CANCELED })])
    await expect(svc.pauseSubscription("sub_1")).rejects.toBeInstanceOf(
      SubscriptionTransitionError
    )
    expect(svc.store.get("sub_1")?.status).toBe(SubscriptionStatus.CANCELED)
  })

  it("still pauses an ACTIVE subscription", async () => {
    const svc = makeSubscriptionService([row()])
    const out = await svc.pauseSubscription("sub_1")
    expect(out.status).toBe(SubscriptionStatus.PAUSED)
  })

  it("survives the orchestrator's error serialisation (name/code, not prototype)", () => {
    const err = new SubscriptionTransitionError({
      subscription_id: "sub_1",
      from_status: "canceled",
      action: "resume",
      allowed_from: ["paused"],
    })
    const serialised = JSON.parse(JSON.stringify({ ...err, name: err.name, message: err.message }))
    expect(serialised.code).toBe("subscription_transition_not_allowed")
    expect(isSubscriptionTransitionError(serialised)).toBe(true)
  })
})

describe("A4 — failSubscription merges metadata (unconditional)", () => {
  it("keeps every existing key and adds failure_reason", async () => {
    const svc = makeSubscriptionService([
      row({ metadata: { initial_order_id: "order_0", creator_listing_id: "cl_1", dunning_attempts: 2 } }),
    ])
    const out = await svc.failSubscription("sub_1", "card_declined")
    expect(out.status).toBe(SubscriptionStatus.FAILED)
    expect(out.metadata).toEqual({
      initial_order_id: "order_0",
      creator_listing_id: "cl_1",
      dunning_attempts: 2,
      failure_reason: "card_declined",
    })
  })
})

describe("getNextOrderDate / until-canceled", () => {
  const svc = makeSubscriptionService([])

  it("an expiration-capped subscription still stops at its horizon (unchanged)", () => {
    expect(
      svc.getNextOrderDate({
        last_order_date: new Date("2027-08-15T00:00:00.000Z"),
        expiration_date: new Date("2027-09-01T00:00:00.000Z"),
        interval: SubscriptionInterval.MONTHLY,
        period: 12,
      })
    ).toBeNull()
  })

  it("a NULL expiration (until-canceled) has no horizon", () => {
    const next = svc.getNextOrderDate({
      last_order_date: new Date("2030-01-15T00:00:00.000Z"),
      expiration_date: null,
      interval: SubscriptionInterval.MONTHLY,
      period: 12,
    })
    expect(next?.toISOString()).toBe("2030-02-15T00:00:00.000Z")
  })

  describe("createSubscriptions", () => {
    const parent = Object.getPrototypeOf(SubscriptionModuleService.prototype) as {
      createSubscriptions: (d: unknown) => Promise<unknown>
    }
    let spy: jest.SpyInstance

    beforeEach(() => {
      spy = jest.spyOn(parent, "createSubscriptions").mockImplementation(async (d) => d)
    })
    afterEach(() => spy.mockRestore())

    it("until_canceled stores expiration_date NULL and still schedules the next order", async () => {
      const svc2 = makeSubscriptionService([])
      const [created] = (await svc2.createSubscriptions({
        interval: SubscriptionInterval.MONTHLY,
        period: 12,
        subscription_date: new Date("2026-10-04T00:00:00.000Z"),
        until_canceled: true,
      })) as unknown as Array<Record<string, unknown>>
      expect(created.expiration_date).toBeNull()
      expect((created.next_order_date as Date).toISOString()).toBe("2026-11-04T00:00:00.000Z")
      expect(created).not.toHaveProperty("until_canceled")
    })

    it("by default the subscription keeps its fixed horizon (unchanged)", async () => {
      const svc2 = makeSubscriptionService([])
      const [created] = (await svc2.createSubscriptions({
        interval: SubscriptionInterval.MONTHLY,
        period: 12,
        subscription_date: new Date("2026-10-04T00:00:00.000Z"),
      })) as unknown as Array<Record<string, unknown>>
      expect((created.expiration_date as Date).toISOString()).toBe("2027-10-04T00:00:00.000Z")
    })
  })
})

describe("F4 lifecycle methods", () => {
  const now = new Date("2026-10-04T12:00:00.000Z")

  it("startGracePeriod(payment_failed): PAST_DUE, length snapshotted, final charge at grace end", async () => {
    const svc = makeSubscriptionService([row()])
    const out = await svc.startGracePeriod("sub_1", {
      reason: "payment_failed",
      grace_period_days: 7,
      starts_at: now,
      now,
    })
    const ends = new Date(now.getTime() + 7 * DAY)
    expect(out.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(out.grace_period_days).toBe(7)
    expect((out.grace_ends_at as Date).toISOString()).toBe(ends.toISOString())
    expect((out.next_order_date as Date).toISOString()).toBe(ends.toISOString())
    expect(out.canceled_at).toBeNull()
    expect(out.metadata).toMatchObject({
      initial_order_id: "order_0",
      blackout_tier: "gold",
      grace_reason: "payment_failed",
      grace_from_status: "active",
    })
  })

  it("startGracePeriod(customer_canceled): canceled_at stamped, nothing further scheduled", async () => {
    const svc = makeSubscriptionService([row({ status: SubscriptionStatus.PAUSED })])
    const paidThrough = new Date("2026-10-20T00:00:00.000Z")
    const out = await svc.startGracePeriod("sub_1", {
      reason: "customer_canceled",
      grace_period_days: 14,
      starts_at: paidThrough,
      now,
    })
    expect(out.status).toBe(SubscriptionStatus.PAST_DUE)
    expect((out.grace_ends_at as Date).toISOString()).toBe(
      new Date(paidThrough.getTime() + 14 * DAY).toISOString()
    )
    expect(out.next_order_date).toBeNull()
    expect(out.canceled_at).toEqual(now)
  })

  it.each([
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.EXPIRED,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.READ_ONLY,
  ])("startGracePeriod refuses from %s", async (status) => {
    const svc = makeSubscriptionService([row({ status })])
    await expect(
      svc.startGracePeriod("sub_1", { reason: "payment_failed", grace_period_days: 7, starts_at: now })
    ).rejects.toBeInstanceOf(SubscriptionTransitionError)
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("enterReadOnly refuses while grace is still running", async () => {
    const svc = makeSubscriptionService([
      row({ status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(now.getTime() + DAY) }),
    ])
    await expect(svc.enterReadOnly("sub_1", now)).rejects.toBeInstanceOf(SubscriptionTransitionError)
    expect(svc.store.get("sub_1")?.status).toBe(SubscriptionStatus.PAST_DUE)
  })

  it("enterReadOnly after grace: READ_ONLY, stamped, row and history kept", async () => {
    const svc = makeSubscriptionService([
      row({ status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(now.getTime() - 1) }),
    ])
    const out = await svc.enterReadOnly("sub_1", now)
    expect(out.status).toBe(SubscriptionStatus.READ_ONLY)
    expect(out.read_only_at).toEqual(now)
    expect(out.next_order_date).toBeNull()
    expect(svc.store.get("sub_1")?.metadata).toEqual(row().metadata)
  })

  it("enterReadOnly refuses from anything but PAST_DUE", async () => {
    const svc = makeSubscriptionService([row({ grace_ends_at: new Date(0) })])
    await expect(svc.enterReadOnly("sub_1", now)).rejects.toBeInstanceOf(SubscriptionTransitionError)
  })

  it("restoreFromGrace: PAST_DUE → ACTIVE, grace cleared", async () => {
    const svc = makeSubscriptionService([
      row({
        status: SubscriptionStatus.PAST_DUE,
        grace_ends_at: new Date(now.getTime() + DAY),
        grace_period_days: 7,
        metadata: { initial_order_id: "order_0", grace_reason: "payment_failed", grace_started_at: "x" },
      }),
    ])
    const out = await svc.restoreFromGrace("sub_1")
    expect(out.status).toBe(SubscriptionStatus.ACTIVE)
    expect(out.grace_ends_at).toBeNull()
    expect(out.grace_period_days).toBeNull()
    expect(out.metadata).toEqual({ initial_order_id: "order_0" })
  })

  it("restoreFromGrace refuses READ_ONLY", async () => {
    const svc = makeSubscriptionService([row({ status: SubscriptionStatus.READ_ONLY })])
    await expect(svc.restoreFromGrace("sub_1")).rejects.toBeInstanceOf(SubscriptionTransitionError)
  })

  it("cancelDuringGrace drops the final charge and never shortens grace", async () => {
    const ends = new Date(now.getTime() + 3 * DAY)
    const svc = makeSubscriptionService([
      row({ status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends }),
    ])
    const out = await svc.cancelDuringGrace("sub_1", now)
    expect(out.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(out.grace_ends_at).toEqual(ends)
    expect(out.next_order_date).toBeNull()
    expect(out.canceled_at).toEqual(now)
  })

  it("listGraceExpired selects PAST_DUE with grace_ends_at <= now", async () => {
    const svc = makeSubscriptionService([
      row({ id: "a", status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(now.getTime() - 1) }),
      row({ id: "b", status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(now.getTime() + 1) }),
      row({ id: "c", status: SubscriptionStatus.ACTIVE, grace_ends_at: new Date(0) }),
    ])
    const out = await svc.listGraceExpired(now)
    expect(out.map((r) => r.id)).toEqual(["a"])
  })
})
