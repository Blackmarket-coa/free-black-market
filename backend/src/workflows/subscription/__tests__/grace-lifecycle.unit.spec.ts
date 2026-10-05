/**
 * F4 lifecycle under FF_CONSUMER_SUBSCRIPTIONS_V1: every transition with the
 * flag on, the flag-off paths unchanged, the grace-not-configured fallback,
 * the per-product override, and until-canceled creation.
 *
 * Real code under test: the subscription service prototype (via the fake
 * store), grace-lifecycle.ts, and the step handlers (the SDK's createStep is
 * stubbed only to hand back each handler). The container resolves only the
 * imported module keys and throws on anything else.
 */
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: unknown, invokeFn: unknown, compensateFn: unknown) =>
    Object.assign(jest.fn(), { invokeFn, compensateFn }),
  StepResponse: class StepResponse {
    constructor(
      public output: unknown,
      public compensateInput?: unknown
    ) {}
  },
}))

jest.mock("../../../lib/blackout-subscription", () => ({
  emitSubscriptionState: jest.fn(async () => "evt_1"),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import { ENTITLEMENT_MODULE } from "../../../modules/entitlement"
import { SubscriptionInterval, SubscriptionStatus } from "../../../modules/subscription/types"
import { SubscriptionTransitionError } from "../../../modules/subscription/errors"
import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import {
  makeContainer,
  makeSubscriptionService,
  type FakeRow,
} from "../../../modules/subscription/__tests__/fake-subscription-service"
import { emitSubscriptionState } from "../../../lib/blackout-subscription"
import {
  READ_EXPORT_FEATURE_KEY,
  SUBSCRIPTION_GRACE_STARTED_EVENT,
  SUBSCRIPTION_READ_ONLY_EVENT,
  sweepGraceLifecycle,
} from "../grace-lifecycle"
import { recordSubscriptionDunningStep } from "../steps/record-subscription-dunning"
import { planSubscriptionCancelStep, REFUND_CANCEL_REASON } from "../steps/plan-subscription-cancel"
import { updateSubscriptionStep } from "../steps/update-subscription"
import { createSubscriptionStep } from "../steps/create-subscription"

const FLAG = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1
const GRACE_ENV = "SUBSCRIPTION_GRACE_PERIOD_DAYS"
const DAY = 24 * 60 * 60 * 1000

type Handler = (input: unknown, ctx: { container: MedusaContainer }) => Promise<{
  output: Record<string, unknown>
  compensateInput?: unknown
}>
const handler = (step: unknown) => (step as { invokeFn: Handler }).invokeFn

const row = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "sub_1",
  status: SubscriptionStatus.ACTIVE,
  interval: SubscriptionInterval.MONTHLY,
  period: 12,
  customer_id: "cus_1",
  product_id: "prod_1",
  seller_id: "sel_1",
  last_order_date: new Date(Date.now() - 30 * DAY),
  next_order_date: new Date(Date.now() + 10 * DAY),
  expiration_date: new Date(Date.now() + 300 * DAY),
  paused_at: null,
  canceled_at: null,
  grace_ends_at: null,
  grace_period_days: null,
  read_only_at: null,
  metadata: { initial_order_id: "order_0" },
  ...overrides,
})

function setup(rows: FakeRow[], productMetadata: Record<string, unknown> | null = null) {
  const svc = makeSubscriptionService(rows)
  const entitlements = {
    extendBySubscriptionId: jest.fn(async () => 1),
    revokeBySubscriptionId: jest.fn(async () => 2),
    grantFromSubscription: jest.fn(async () => ({ id: "ent_ro" })),
  }
  const eventBus = { emit: jest.fn(async () => undefined) }
  const query = {
    graph: jest.fn(async () => ({ data: productMetadata ? [{ id: "prod_1", metadata: productMetadata }] : [] })),
  }
  const container = makeContainer({
    [SUBSCRIPTION_MODULE]: svc,
    [ENTITLEMENT_MODULE]: entitlements,
    [Modules.EVENT_BUS]: eventBus,
    [ContainerRegistrationKeys.QUERY]: query,
  }) as unknown as MedusaContainer
  return { svc, entitlements, eventBus, query, container }
}

let warnSpy: jest.SpyInstance

beforeEach(() => {
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined)
  ;(emitSubscriptionState as jest.Mock).mockClear()
})

afterEach(() => {
  delete process.env[FLAG]
  delete process.env[GRACE_ENV]
  warnSpy.mockRestore()
})

const warned = (fragment: string) =>
  warnSpy.mock.calls.some((args) => String(args[0]).includes(fragment))

// ---------------------------------------------------------------------------
describe("(a) exhausting dunning", () => {
  const exhausted = () => row({ metadata: { initial_order_id: "order_0", dunning_attempts: 2 } })

  it("flag OFF: pauses exactly as before — no grace, no product lookup, no event", async () => {
    process.env[GRACE_ENV] = "7"
    const { svc, query, eventBus, container } = setup([exhausted()])
    const res = await handler(recordSubscriptionDunningStep)({ subscription_id: "sub_1", error: "declined" }, { container })

    expect(res.output).toMatchObject({ paused: true, attempts: 3, next_retry_at: null })
    expect(res.output).not.toHaveProperty("grace_started")
    expect(svc.store.get("sub_1")?.status).toBe(SubscriptionStatus.PAUSED)
    expect(svc.store.get("sub_1")?.grace_ends_at).toBeNull()
    expect(query.graph).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it("flag ON + platform grace: PAST_DUE, snapshot, entitlements extended, grace_started emitted", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "7"
    const { svc, entitlements, eventBus, container } = setup([exhausted()])
    const before = Date.now()
    const res = await handler(recordSubscriptionDunningStep)({ subscription_id: "sub_1", error: "declined" }, { container })

    const stored = svc.store.get("sub_1") as FakeRow
    expect(stored.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(stored.grace_period_days).toBe(7)
    const ends = new Date(stored.grace_ends_at as Date).getTime()
    expect(ends).toBeGreaterThanOrEqual(before + 7 * DAY)
    expect(ends).toBeLessThanOrEqual(Date.now() + 7 * DAY)
    expect(new Date(stored.next_order_date as Date).getTime()).toBe(ends)
    expect(res.output).toMatchObject({ paused: false, grace_started: true, attempts: 3 })

    expect(entitlements.extendBySubscriptionId).toHaveBeenCalledWith("sub_1", new Date(ends))
    expect(entitlements.revokeBySubscriptionId).not.toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith({
      name: SUBSCRIPTION_GRACE_STARTED_EVENT,
      data: {
        subscription_id: "sub_1",
        customer_id: "cus_1",
        product_id: "prod_1",
        seller_id: "sel_1",
        grace_ends_at: new Date(ends).toISOString(),
      },
    })
  })

  it("flag ON + per-product override beats the platform default", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "30"
    const { svc, container } = setup([exhausted()], { subscription_grace_period_days: "3" })
    await handler(recordSubscriptionDunningStep)({ subscription_id: "sub_1" }, { container })
    expect(svc.store.get("sub_1")?.grace_period_days).toBe(3)
  })

  it("flag ON but NO grace configured: today's pause, plus a warning — no invented length", async () => {
    process.env[FLAG] = "true"
    const { svc, eventBus, container } = setup([exhausted()])
    const res = await handler(recordSubscriptionDunningStep)({ subscription_id: "sub_1" }, { container })

    expect(res.output).toMatchObject({ paused: true })
    expect(svc.store.get("sub_1")?.status).toBe(SubscriptionStatus.PAUSED)
    expect(svc.store.get("sub_1")?.grace_period_days).toBeNull()
    expect(eventBus.emit).not.toHaveBeenCalled()
    expect(warned("no grace length is configured")).toBe(true)
  })

  it("a retry that is not yet exhausted is unaffected by the flag", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "7"
    const { svc, container } = setup([row()])
    const res = await handler(recordSubscriptionDunningStep)({ subscription_id: "sub_1" }, { container })
    expect(res.output).toMatchObject({ paused: false, attempts: 1 })
    expect(svc.store.get("sub_1")?.status).toBe(SubscriptionStatus.ACTIVE)
  })
})

// ---------------------------------------------------------------------------
describe("(b) customer cancel", () => {
  const plan = (input: unknown, container: MedusaContainer) =>
    handler(planSubscriptionCancelStep)(input, { container })
  const update = (input: unknown, container: MedusaContainer) =>
    handler(updateSubscriptionStep)(input, { container })

  it("flag OFF: plan is legacy without reading anything; cancel ends the subscription as before", async () => {
    process.env[GRACE_ENV] = "7"
    const { svc, query, container } = setup([row()])
    const p = await plan({ subscription_id: "sub_1", action: "cancel" }, container)
    expect(p.output).toEqual({ mode: "legacy" })
    expect(svc.retrieveSubscription).not.toHaveBeenCalled()
    expect(query.graph).not.toHaveBeenCalled()

    const u = await update({ subscription_id: "sub_1", action: "cancel", cancel_plan: p.output }, container)
    expect((u.output.subscription as FakeRow).status).toBe(SubscriptionStatus.CANCELED)
    expect(svc.store.get("sub_1")?.next_order_date).toBeNull()
    expect(u.compensateInput).toMatchObject({ lifecycle: false })
  })

  it("flag ON: grace through the paid period plus grace; nothing revoked; event emitted", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "14"
    const paidThrough = new Date(Date.now() + 10 * DAY)
    const { svc, entitlements, eventBus, container } = setup([row({ next_order_date: paidThrough })])

    const p = await plan({ subscription_id: "sub_1", action: "cancel" }, container)
    expect(p.output).toEqual({ mode: "grace", resolution: { days: 14, source: "platform" } })

    const u = await update({ subscription_id: "sub_1", action: "cancel", cancel_plan: p.output }, container)
    const stored = svc.store.get("sub_1") as FakeRow
    expect((u.output.subscription as FakeRow).status).toBe(SubscriptionStatus.PAST_DUE)
    expect(stored.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(new Date(stored.grace_ends_at as Date).toISOString()).toBe(
      new Date(paidThrough.getTime() + 14 * DAY).toISOString()
    )
    expect(stored.next_order_date).toBeNull()
    expect(stored.canceled_at).toBeInstanceOf(Date)
    expect(entitlements.revokeBySubscriptionId).not.toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: SUBSCRIPTION_GRACE_STARTED_EVENT })
    )
    expect(u.compensateInput).toMatchObject({ lifecycle: true })
  })

  it("flag ON with the paid period already over: grace starts now", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "5"
    const { svc, container } = setup([row({ next_order_date: new Date(Date.now() - DAY) })])
    const before = Date.now()
    const p = await plan({ subscription_id: "sub_1", action: "cancel" }, container)
    await update({ subscription_id: "sub_1", action: "cancel", cancel_plan: p.output }, container)
    const ends = new Date(svc.store.get("sub_1")?.grace_ends_at as Date).getTime()
    expect(ends).toBeGreaterThanOrEqual(before + 5 * DAY)
    expect(ends).toBeLessThanOrEqual(Date.now() + 5 * DAY)
  })

  it("flag ON: a REFUND-driven cancel still ends access at once (refund policy is not decided)", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "14"
    const { svc, entitlements, eventBus, query, container } = setup([row()])
    const p = await plan(
      { subscription_id: "sub_1", action: "cancel", reason: REFUND_CANCEL_REASON },
      container
    )
    expect(p.output).toEqual({ mode: "legacy" })
    expect(query.graph).not.toHaveBeenCalled()

    const u = await update(
      { subscription_id: "sub_1", action: "cancel", reason: REFUND_CANCEL_REASON, cancel_plan: p.output },
      container
    )
    // CANCELED, not PAST_DUE: the workflow's revoke + Blackout lapse gates fire.
    expect((u.output.subscription as FakeRow).status).toBe(SubscriptionStatus.CANCELED)
    expect(svc.store.get("sub_1")?.grace_ends_at).toBeNull()
    expect(entitlements.extendBySubscriptionId).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it("flag ON but NO grace configured: legacy cancel, plus a warning", async () => {
    process.env[FLAG] = "true"
    const { container } = setup([row()])
    const p = await plan({ subscription_id: "sub_1", action: "cancel" }, container)
    expect(p.output).toEqual({ mode: "legacy" })
    expect(warned("no grace length is configured")).toBe(true)
  })

  it("flag ON, already in payment grace: records the cancel, keeps grace", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "7"
    const ends = new Date(Date.now() + 3 * DAY)
    const { svc, container } = setup([
      row({ status: SubscriptionStatus.PAST_DUE, grace_ends_at: ends, next_order_date: ends }),
    ])
    const p = await plan({ subscription_id: "sub_1", action: "cancel" }, container)
    expect(p.output).toEqual({ mode: "cancel_during_grace" })
    await update({ subscription_id: "sub_1", action: "cancel", cancel_plan: p.output }, container)
    expect(svc.store.get("sub_1")).toMatchObject({
      status: SubscriptionStatus.PAST_DUE,
      grace_ends_at: ends,
      next_order_date: null,
    })
  })

  it("flag ON: a READ_ONLY subscription cannot be canceled (would revoke read/export)", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "7"
    const { container } = setup([row({ status: SubscriptionStatus.READ_ONLY })])
    await expect(plan({ subscription_id: "sub_1", action: "cancel" }, container)).rejects.toBeInstanceOf(
      SubscriptionTransitionError
    )
  })

  it("pause/resume are always legacy plans", async () => {
    process.env[FLAG] = "true"
    const { container } = setup([row()])
    expect((await plan({ subscription_id: "sub_1", action: "pause" }, container)).output).toEqual({
      mode: "legacy",
    })
  })
})

// ---------------------------------------------------------------------------
describe("(c) grace ends → read-only, never deletion", () => {
  it("PAST_DUE past grace_ends_at → READ_ONLY; grants swapped for read/export; events", async () => {
    const now = new Date()
    const { svc, entitlements, eventBus, container } = setup([
      row({ id: "due", status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(now.getTime() - 1) }),
      row({ id: "running", status: SubscriptionStatus.PAST_DUE, grace_ends_at: new Date(now.getTime() + DAY) }),
    ])
    const out = await sweepGraceLifecycle(container, now)

    expect(out.read_only).toEqual(["due"])
    expect(svc.store.get("due")).toMatchObject({ status: SubscriptionStatus.READ_ONLY, read_only_at: now })
    expect(svc.store.get("running")?.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(svc.store.size).toBe(2)

    expect(entitlements.revokeBySubscriptionId).toHaveBeenCalledWith("due", "subscription_read_only")
    expect(entitlements.grantFromSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_id: "due", feature_key: READ_EXPORT_FEATURE_KEY, expires_at: null })
    )
    expect(emitSubscriptionState).toHaveBeenCalledWith(container, expect.objectContaining({ id: "due" }), "cancel")
    expect(eventBus.emit).toHaveBeenCalledWith({
      name: SUBSCRIPTION_READ_ONLY_EVENT,
      data: {
        subscription_id: "due",
        customer_id: "cus_1",
        product_id: "prod_1",
        seller_id: "sel_1",
        read_only_at: now.toISOString(),
      },
    })
  })

  it("dunning-paused rows from before the flag enter grace (from now); customer-paused rows do not", async () => {
    process.env[GRACE_ENV] = "7"
    const now = new Date()
    const { svc, container } = setup([
      row({
        id: "dunned",
        status: SubscriptionStatus.PAUSED,
        paused_at: new Date(now.getTime() - 60 * DAY),
        metadata: {
          paused_reason: "payment_failed_after_3_attempts: declined",
          dunning_last_attempt_at: new Date(now.getTime() - 60 * DAY - 5).toISOString(),
        },
      }),
      row({ id: "chose", status: SubscriptionStatus.PAUSED, metadata: {} }),
    ])
    const out = await sweepGraceLifecycle(container, now)
    expect(out.dunning_paused_to_grace).toEqual(["dunned"])
    expect(out.read_only).toEqual([])
    expect(svc.store.get("dunned")?.status).toBe(SubscriptionStatus.PAST_DUE)
    expect(new Date(svc.store.get("dunned")?.grace_ends_at as Date).toISOString()).toBe(
      new Date(now.getTime() + 7 * DAY).toISOString()
    )
    expect(svc.store.get("chose")?.status).toBe(SubscriptionStatus.PAUSED)
  })

  it("dunning-paused → resumed → paused by the CUSTOMER: never swept into grace", async () => {
    process.env[FLAG] = "true"
    process.env[GRACE_ENV] = "7"
    const { svc, container } = setup([row({ id: "r" })])
    // The real dunning writes, in order, then the real resume and pause.
    await svc.recordDunningAttempt("r", "declined")
    await svc.pauseSubscriptionWithReason("r", "payment_failed_after_3_attempts: declined")
    await svc.resumeSubscription("r")
    expect(svc.store.get("r")?.metadata).not.toHaveProperty("paused_reason")
    await svc.pauseSubscription("r")

    const out = await sweepGraceLifecycle(container, new Date())
    expect(out.dunning_paused_to_grace).toEqual([])
    expect(svc.store.get("r")?.status).toBe(SubscriptionStatus.PAUSED)
  })

  it("a customer pause drops a stale dunning paused_reason left on an ACTIVE row by older code", async () => {
    const { svc } = setup([
      row({ id: "old", metadata: { initial_order_id: "order_0", paused_reason: "payment_failed_after_3_attempts: x" } }),
    ])
    await svc.pauseSubscription("old")
    expect(svc.store.get("old")?.metadata).toEqual({ initial_order_id: "order_0" })
  })

  it("a stale reason left by older code (customer pause long after the last dunning attempt) is not swept", async () => {
    process.env[GRACE_ENV] = "7"
    const now = new Date()
    const { svc, container } = setup([
      row({
        id: "stale",
        status: SubscriptionStatus.PAUSED,
        paused_at: new Date(now.getTime() - DAY),
        metadata: {
          paused_reason: "payment_failed_after_3_attempts: declined",
          dunning_last_attempt_at: new Date(now.getTime() - 40 * DAY).toISOString(),
        },
      }),
    ])
    const out = await sweepGraceLifecycle(container, now)
    expect(out.dunning_paused_to_grace).toEqual([])
    expect(svc.store.get("stale")?.status).toBe(SubscriptionStatus.PAUSED)
  })

  it("flag ON, no grace configured: dunning-paused rows stay paused; ONE summary warning per sweep", async () => {
    const now = new Date()
    const dunned = (id: string) =>
      row({
        id,
        status: SubscriptionStatus.PAUSED,
        paused_at: now,
        metadata: {
          paused_reason: "payment_failed_after_3_attempts: declined",
          dunning_last_attempt_at: new Date(now.getTime() - 5).toISOString(),
        },
      })
    const { svc, container } = setup([dunned("a"), dunned("b"), dunned("c")])
    const out = await sweepGraceLifecycle(container, now)
    expect(out.dunning_paused_to_grace).toEqual([])
    expect(svc.store.get("a")?.status).toBe(SubscriptionStatus.PAUSED)
    const graceWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("no grace length is configured")
    )
    expect(graceWarnings).toHaveLength(1)
    expect(String(graceWarnings[0][0])).toContain("3 dunning-paused subscription(s) stay paused")
  })
})

// ---------------------------------------------------------------------------
describe("(d) until-canceled creation", () => {
  const create = (container: MedusaContainer) =>
    handler(createSubscriptionStep)(
      {
        cart_id: "cart_1",
        order_id: "order_1",
        customer_id: "cus_1",
        product_id: "prod_1",
        subscription_data: { interval: SubscriptionInterval.MONTHLY, period: 12 },
      },
      { container }
    )

  function withCreate(productMetadata: Record<string, unknown> | null) {
    const ctx = setup([], productMetadata)
    const createSubscriptions = jest.fn(async (d: Record<string, unknown>) => [{ id: "sub_new", ...d }])
    ;(ctx.svc as unknown as { createSubscriptions: jest.Mock }).createSubscriptions = createSubscriptions
    return { ...ctx, createSubscriptions }
  }

  it("flag ON + product opts in: until_canceled", async () => {
    process.env[FLAG] = "true"
    const { createSubscriptions, container } = withCreate({ subscription_until_canceled: true })
    await create(container)
    expect(createSubscriptions.mock.calls[0][0]).toMatchObject({ until_canceled: true })
  })

  it("flag ON + product does not opt in: fixed horizon", async () => {
    process.env[FLAG] = "true"
    const { createSubscriptions, container } = withCreate({})
    await create(container)
    expect(createSubscriptions.mock.calls[0][0]).not.toHaveProperty("until_canceled")
  })

  it("flag OFF: the product is not even looked up", async () => {
    const { createSubscriptions, query, container } = withCreate({ subscription_until_canceled: true })
    await create(container)
    expect(query.graph).not.toHaveBeenCalled()
    expect(createSubscriptions.mock.calls[0][0]).not.toHaveProperty("until_canceled")
  })
})
