/**
 * The hourly renewal job — previously without a spec.
 *
 * Real code: the job, the subscription service prototype (fake store),
 * grace-lifecycle.ts. Stubbed: the two workflows the job invokes (their
 * insides have their own specs) and the Blackout emitter.
 */
const renewRun = jest.fn()
const failureRun = jest.fn()

jest.mock("../../workflows/subscription/workflows/renew-subscription", () => ({
  renewSubscriptionWorkflow: jest.fn(() => ({ run: renewRun })),
}))
jest.mock("../../workflows/subscription/workflows/handle-subscription-failure", () => ({
  handleSubscriptionFailureWorkflow: jest.fn(() => ({ run: failureRun })),
}))
jest.mock("../../lib/blackout-subscription", () => ({
  emitSubscriptionState: jest.fn(async () => "evt_1"),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import processSubscriptionRenewals from "../process-subscription-renewals"
import { SUBSCRIPTION_MODULE } from "../../modules/subscription"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { SubscriptionInterval, SubscriptionStatus } from "../../modules/subscription/types"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"
import { renewalPeriodStart } from "../../modules/subscription/utils/renewal-charge"
import {
  makeContainer,
  makeSubscriptionService,
  type FakeRow,
} from "../../modules/subscription/__tests__/fake-subscription-service"

const FLAG = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1
const DAY = 24 * 60 * 60 * 1000

const row = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "sub_1",
  status: SubscriptionStatus.ACTIVE,
  interval: SubscriptionInterval.MONTHLY,
  period: 12,
  customer_id: "cus_1",
  product_id: "prod_1",
  seller_id: "sel_1",
  last_order_date: new Date(Date.now() - 31 * DAY),
  next_order_date: new Date(Date.now() - 60_000),
  expiration_date: new Date(Date.now() + 300 * DAY),
  paused_at: null,
  canceled_at: null,
  grace_ends_at: null,
  grace_period_days: null,
  read_only_at: null,
  metadata: {},
  ...overrides,
})

function setup(rows: FakeRow[]) {
  const svc = makeSubscriptionService(rows)
  const entitlements = {
    extendBySubscriptionId: jest.fn(async () => 0),
    revokeBySubscriptionId: jest.fn(async () => 0),
    grantFromSubscription: jest.fn(async () => ({ id: "ent" })),
  }
  const eventBus = { emit: jest.fn(async () => undefined) }
  const query = { graph: jest.fn(async () => ({ data: [] })) }
  const container = makeContainer({
    [SUBSCRIPTION_MODULE]: svc,
    [ENTITLEMENT_MODULE]: entitlements,
    [Modules.EVENT_BUS]: eventBus,
    [ContainerRegistrationKeys.QUERY]: query,
  }) as unknown as MedusaContainer
  return { svc, entitlements, eventBus, container }
}

let logSpies: jest.SpyInstance[] = []
beforeEach(() => {
  renewRun.mockReset().mockResolvedValue({ result: {} })
  failureRun.mockReset().mockResolvedValue({ result: {} })
  logSpies = [
    jest.spyOn(console, "log").mockImplementation(() => undefined),
    jest.spyOn(console, "warn").mockImplementation(() => undefined),
    jest.spyOn(console, "error").mockImplementation(() => undefined),
  ]
})
afterEach(() => {
  delete process.env[FLAG]
  delete process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE
  delete process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS
  logSpies.forEach((s) => s.mockRestore())
})

describe("flag OFF — every path as before", () => {
  it("legacy renewal, expiry sweep, and nothing touches PAST_DUE rows", async () => {
    const { svc, container } = setup([
      row({ id: "due" }),
      row({ id: "until", expiration_date: null }),
      row({ id: "lapsed", next_order_date: null, expiration_date: new Date(Date.now() - DAY) }),
      row({ id: "until_idle", next_order_date: null, expiration_date: null }),
      row({ id: "grace", status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(Date.now() - DAY) }),
    ])
    await processSubscriptionRenewals(container)

    // Exactly the two reads the job always made.
    expect(svc.listSubscriptions.mock.calls.map((c) => c[0])).toEqual([
      { status: SubscriptionStatus.ACTIVE, next_order_date: { $lte: expect.any(Date) } },
      { status: SubscriptionStatus.ACTIVE },
    ])
    // Legacy (not live): dates advanced, no workflow.
    expect(renewRun).not.toHaveBeenCalled()
    expect(svc.store.get("due")?.last_order_date).not.toEqual(row().last_order_date)
    expect(svc.store.get("lapsed")?.status).toBe(SubscriptionStatus.EXPIRED)
    expect(svc.store.get("grace")?.status).toBe(SubscriptionStatus.PAST_DUE)
  })

  it("until-canceled (expiration NULL) is renewed, never expired", async () => {
    const { svc, container } = setup([
      row({ id: "until", expiration_date: null }),
      row({ id: "until_idle", next_order_date: null, expiration_date: null }),
    ])
    await processSubscriptionRenewals(container)
    expect(svc.store.get("until")?.status).toBe(SubscriptionStatus.ACTIVE)
    expect(svc.store.get("until")?.next_order_date).toBeInstanceOf(Date)
    expect(svc.store.get("until_idle")?.status).toBe(SubscriptionStatus.ACTIVE)
  })

  it("live: an ACTIVE renewal failure still goes to the dunning workflow", async () => {
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    renewRun.mockRejectedValueOnce(new Error("no_payment_method"))
    const { container } = setup([row({ id: "due" })])
    await processSubscriptionRenewals(container)
    expect(failureRun).toHaveBeenCalledWith({ input: { subscription_id: "due", error: "no_payment_method" } })
  })
})

describe("flag ON", () => {
  it("live: the final grace charge succeeds → ACTIVE (d)", async () => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    const ends = new Date(Date.now() - 60_000)
    const { svc, container } = setup([
      row({ id: "g", status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends, grace_period_days: 7 }),
    ])
    await processSubscriptionRenewals(container)

    expect(renewRun).toHaveBeenCalledWith({ input: { subscription_id: "g" } })
    expect(svc.store.get("g")).toMatchObject({
      status: SubscriptionStatus.ACTIVE,
      grace_ends_at: null,
      grace_period_days: null,
    })
    expect(failureRun).not.toHaveBeenCalled()
  })

  it("live: the final grace charge fails → no dunning, nothing more scheduled, then READ_ONLY (c)", async () => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    renewRun.mockRejectedValueOnce(new Error("card_declined"))
    const ends = new Date(Date.now() - 60_000)
    const { svc, container } = setup([
      row({ id: "g", status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends }),
    ])
    await processSubscriptionRenewals(container)

    expect(failureRun).not.toHaveBeenCalled()
    expect(svc.store.get("g")).toMatchObject({
      status: SubscriptionStatus.READ_ONLY,
      next_order_date: null,
    })
    expect(svc.store.get("g")?.read_only_at).toBeInstanceOf(Date)
  })

  /** The charge step's record for this row's current cycle. */
  const chargeRecord = (r: FakeRow, status: string, payment_intent_id: string | null) => ({
    period_start: renewalPeriodStart(
      r.last_order_date as Date,
      r.interval as SubscriptionInterval
    ).toISOString(),
    idempotency_key: "k",
    amount: 1000,
    currency_code: "usd",
    status,
    payment_intent_id,
    recorded_at: new Date().toISOString(),
  })

  it("live: the final grace charge SUCCEEDED but a later step failed → held, never READ_ONLY", async () => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    const ends = new Date(Date.now() - 60_000)
    const g = row({ id: "g", status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends })
    const { svc, container } = setup([g])
    // The charge step records the collected cycle, then completeCart throws.
    renewRun.mockImplementationOnce(async () => {
      await svc.recordRenewalCharge("g", chargeRecord(g, "succeeded", "pi_1") as never)
      throw new Error("completeCart failed")
    })
    const before = Date.now()
    await processSubscriptionRenewals(container)

    const after = svc.store.get("g")!
    expect(after.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(after.read_only_at).toBeNull()
    // Still due, so the next run completes the order (the charge replays).
    expect((after.next_order_date as Date).getTime()).toBeLessThanOrEqual(Date.now())
    expect((after.grace_ends_at as Date).getTime()).toBeGreaterThan(before)
    expect(failureRun).not.toHaveBeenCalled()
  })

  it("live: a grace charge left `processing` or `pending` with an intent id is held too", async () => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    const ends = new Date(Date.now() - 60_000)
    const p = row({ id: "p", status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends })
    const q = row({ id: "q", status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends })
    const { svc, container } = setup([p, q])
    renewRun.mockImplementation(async ({ input }: { input: { subscription_id: string } }) => {
      const r = input.subscription_id === "p" ? p : q
      await svc.recordRenewalCharge(
        r.id,
        chargeRecord(r, r.id === "p" ? "processing" : "pending", "pi_x") as never
      )
      throw new Error("later step failed")
    })
    await processSubscriptionRenewals(container)
    expect(svc.store.get("p")?.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(svc.store.get("q")?.status).toBe(SubscriptionStatus.PAST_DUE)
  })

  it("live: a grace charge recorded FAILED (money did not move) still goes READ_ONLY", async () => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    const ends = new Date(Date.now() - 60_000)
    const g = row({ id: "g", status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends })
    const { svc, container } = setup([g])
    renewRun.mockImplementationOnce(async () => {
      await svc.recordRenewalCharge("g", chargeRecord(g, "failed", "pi_1") as never)
      throw new Error("card_declined")
    })
    await processSubscriptionRenewals(container)
    expect(svc.store.get("g")).toMatchObject({ status: SubscriptionStatus.READ_ONLY, next_order_date: null })
  })

  it("live: renewal completed but the restore write failed → grace held through the paid period", async () => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    const ends = new Date(Date.now() - 60_000)
    const paidThrough = new Date(Date.now() + 30 * DAY)
    const { svc, container } = setup([
      row({ id: "g", status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends }),
    ])
    // The workflow rolled the period (record_order) ...
    renewRun.mockImplementationOnce(async () => {
      svc.store.set("g", { ...svc.store.get("g")!, last_order_date: new Date(), next_order_date: paidThrough })
      return { result: {} }
    })
    // ... and then the restore write fails.
    const realRestore = svc.restoreFromGrace.bind(svc)
    svc.restoreFromGrace = jest.fn(async () => {
      throw new Error("db write failed")
    }) as never
    await processSubscriptionRenewals(container)
    svc.restoreFromGrace = realRestore

    expect(svc.store.get("g")).toMatchObject({
      status: SubscriptionStatus.PAST_DUE,
      grace_ends_at: paidThrough,
      next_order_date: paidThrough,
    })
    expect(renewRun).toHaveBeenCalledTimes(1)
  })

  it("not live: grace rows are never charged; the sweep still moves them to READ_ONLY", async () => {
    process.env[FLAG] = "true"
    const ends = new Date(Date.now() - 60_000)
    const { svc, container } = setup([
      row({ id: "g", status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends }),
      row({ id: "running", status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(Date.now() + DAY), next_order_date: null }),
    ])
    await processSubscriptionRenewals(container)
    expect(renewRun).not.toHaveBeenCalled()
    expect(svc.store.get("g")?.status).toBe(SubscriptionStatus.READ_ONLY)
    expect(svc.store.get("running")?.status).toBe(SubscriptionStatus.PAST_DUE)
  })

  it("a customer-canceled grace row (next_order_date NULL) is never charged", async () => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    const { container } = setup([
      row({ id: "c", status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(Date.now() + DAY), next_order_date: null }),
    ])
    await processSubscriptionRenewals(container)
    expect(renewRun).not.toHaveBeenCalled()
  })
})
