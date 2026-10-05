/**
 * Affirmative auto-renew approval (Black Mask F2, FF_CONSUMER_SUBSCRIPTIONS_V1;
 * operator answer 2026-10-05, "renew upon approval").
 *
 * Real code under test: createSubscriptionStep's handler (the SDK's
 * createStep is stubbed only to hand it back), the REAL
 * SubscriptionModuleService prototype over the in-memory fake store —
 * createSubscriptions, withdrawAutoRenew, approveAutoRenew — the renewal job,
 * and saveAutoRenewPaymentMethod. Stubbed: the generated base
 * `createSubscriptions` (it only persists), the two workflows the job invokes,
 * the Blackout emitter. The container resolves only imported keys and throws
 * on anything else.
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

const renewRun = jest.fn()
const failureRun = jest.fn()
jest.mock("../workflows/renew-subscription", () => ({
  renewSubscriptionWorkflow: jest.fn(() => ({ run: renewRun })),
}))
jest.mock("../workflows/handle-subscription-failure", () => ({
  handleSubscriptionFailureWorkflow: jest.fn(() => ({ run: failureRun })),
}))
jest.mock("../../../lib/blackout-subscription", () => ({
  emitSubscriptionState: jest.fn(async () => "evt_1"),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import SubscriptionModuleService from "../../../modules/subscription/service"
import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import { ENTITLEMENT_MODULE } from "../../../modules/entitlement"
import { SubscriptionInterval, SubscriptionStatus } from "../../../modules/subscription/types"
import {
  AutoRenewError,
  SubscriptionTransitionError,
} from "../../../modules/subscription/errors"
import {
  AUTO_RENEW_DISCLOSURE_VERSION,
  AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
  decideCreateTerms,
} from "../../../modules/subscription/utils/auto-renew"
import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import {
  makeContainer,
  makeSubscriptionService,
  type FakeRow,
} from "../../../modules/subscription/__tests__/fake-subscription-service"
import { createSubscriptionStep } from "../steps/create-subscription"
import { saveAutoRenewPaymentMethod } from "../auto-renew"
import processSubscriptionRenewals from "../../../jobs/process-subscription-renewals"

const FLAG = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1
const DAY = 24 * 60 * 60 * 1000

type Handler = (input: unknown, ctx: { container: MedusaContainer }) => Promise<{
  output: { subscription: Record<string, unknown> }
}>
const handler = (step: unknown) => (step as { invokeFn: Handler }).invokeFn

const parent = Object.getPrototypeOf(SubscriptionModuleService.prototype) as {
  createSubscriptions: (d: unknown) => Promise<unknown>
}

let parentSpy: jest.SpyInstance
let logSpies: jest.SpyInstance[] = []
beforeEach(() => {
  // The generated base method only persists; hand back what it was given so
  // the real override's date math is what the assertions see.
  parentSpy = jest
    .spyOn(parent, "createSubscriptions")
    .mockImplementation(async (d) => ({ id: "sub_new", ...(d as object) }))
  renewRun.mockReset().mockResolvedValue({ result: {} })
  failureRun.mockReset().mockResolvedValue({ result: {} })
  logSpies = [
    jest.spyOn(console, "log").mockImplementation(() => undefined),
    jest.spyOn(console, "warn").mockImplementation(() => undefined),
    jest.spyOn(console, "error").mockImplementation(() => undefined),
  ]
})
afterEach(() => {
  parentSpy.mockRestore()
  logSpies.forEach((s) => s.mockRestore())
  delete process.env[FLAG]
  delete process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE
  delete process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS
})

const row = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "sub_1",
  status: SubscriptionStatus.ACTIVE,
  interval: SubscriptionInterval.MONTHLY,
  period: 1,
  customer_id: "cus_1",
  product_id: "prod_1",
  seller_id: "sel_1",
  last_order_date: new Date("2026-10-01T00:00:00.000Z"),
  next_order_date: new Date("2026-11-01T00:00:00.000Z"),
  expiration_date: null,
  paused_at: null,
  canceled_at: null,
  grace_ends_at: null,
  grace_period_days: null,
  read_only_at: null,
  payment_method_id: "pm_saved",
  auto_renew_approved: true,
  auto_renew_approved_at: new Date("2026-10-01T00:00:00.000Z"),
  auto_renew_disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
  metadata: { initial_order_id: "order_0" },
  ...overrides,
})

// ---------------------------------------------------------------------------
describe("decideCreateTerms (pure)", () => {
  it("until cancelled only with approval AND a product that may be sold that way", () => {
    expect(decideCreateTerms({ approved: true, product_allows_until_canceled: true })).toEqual({
      mode: "until_canceled",
    })
    expect(decideCreateTerms({ approved: true, product_allows_until_canceled: false })).toEqual({
      mode: "single_period",
    })
    expect(decideCreateTerms({ approved: false, product_allows_until_canceled: true })).toEqual({
      mode: "single_period",
    })
  })
})

// ---------------------------------------------------------------------------
describe("creation: createSubscriptionStep → the real service", () => {
  const APPROVED_AT = "2026-10-05T12:00:00.000Z"

  function setup(productMetadata: Record<string, unknown> | null) {
    const svc = makeSubscriptionService([])
    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => {
        if (entity !== "product") throw new Error(`unexpected entity ${entity}`)
        return { data: productMetadata === null ? [] : [{ id: "prod_1", metadata: productMetadata }] }
      }),
    }
    const container = makeContainer({
      [SUBSCRIPTION_MODULE]: svc,
      [ContainerRegistrationKeys.QUERY]: query,
    }) as unknown as MedusaContainer
    return { svc, query, container }
  }

  const run = (container: MedusaContainer, autoRenew?: Record<string, unknown>) =>
    handler(createSubscriptionStep)(
      {
        cart_id: "cart_1",
        order_id: "order_1",
        customer_id: "cus_1",
        product_id: "prod_1",
        subscription_data: {
          interval: SubscriptionInterval.MONTHLY,
          period: 12,
          ...(autoRenew ? { auto_renew: autoRenew } : {}),
        },
      },
      { container }
    )

  const created = () => parentSpy.mock.calls[0][0] as Record<string, unknown>

  it("approved + product marked: until cancelled, approval recorded with version and timestamp", async () => {
    process.env[FLAG] = "true"
    const { container } = setup({ subscription_until_canceled: true })
    await run(container, {
      approved: true,
      disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
      approved_at: APPROVED_AT,
    })
    const c = created()
    expect(c.expiration_date).toBeNull()
    expect(c.next_order_date).toBeInstanceOf(Date)
    expect(c.auto_renew_approved).toBe(true)
    expect((c.auto_renew_approved_at as Date).toISOString()).toBe(APPROVED_AT)
    expect(c.auto_renew_disclosure_version).toBe(AUTO_RENEW_DISCLOSURE_VERSION)
    expect(c).not.toHaveProperty("auto_renew")
    expect(c).not.toHaveProperty("until_canceled")
  })

  it("declined: exactly one period, nothing scheduled, never renews", async () => {
    process.env[FLAG] = "true"
    const { container } = setup({ subscription_until_canceled: true })
    await run(container, { approved: false, disclosure_version: null, approved_at: APPROVED_AT })
    const c = created()
    expect(c.period).toBe(1)
    expect(c.next_order_date).toBeNull()
    expect(c.auto_renew_approved).toBe(false)
    expect(c).not.toHaveProperty("auto_renew_approved_at")
    const start = new Date(c.subscription_date as Date)
    const end = new Date(c.expiration_date as Date)
    const expected = new Date(start)
    expected.setMonth(expected.getMonth() + 1)
    expect(end.toISOString()).toBe(expected.toISOString())
    expect(c).not.toHaveProperty("single_period")
    expect((c.metadata as Record<string, unknown>).auto_renew_mode).toBe("single_period")
  })

  it("approved but the product is not marked: one period, approval not recorded as on", async () => {
    process.env[FLAG] = "true"
    const { container } = setup({})
    await run(container, {
      approved: true,
      disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
      approved_at: APPROVED_AT,
    })
    const c = created()
    expect(c.period).toBe(1)
    expect(c.next_order_date).toBeNull()
    expect(c.auto_renew_approved).toBe(false)
  })

  it("product marked but NO answer recorded (Blackout hosted checkout): never until cancelled", async () => {
    process.env[FLAG] = "true"
    const { container, query } = setup({ subscription_until_canceled: true })
    await run(container)
    const c = created()
    expect(c.expiration_date).not.toBeNull()
    expect(c.period).toBe(12)
    expect(c).not.toHaveProperty("auto_renew_approved")
    expect(query.graph).not.toHaveBeenCalled()
  })

  it("flag OFF: an answer is ignored, the product is not looked up, the write is the legacy one", async () => {
    const { container, query } = setup({ subscription_until_canceled: true })
    await run(container, {
      approved: true,
      disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
      approved_at: APPROVED_AT,
    })
    expect(query.graph).not.toHaveBeenCalled()
    expect(Object.keys(created()).sort()).toEqual(
      [
        "customer_id",
        "expiration_date",
        "interval",
        "last_order_date",
        "metadata",
        "next_order_date",
        "period",
        "product_id",
        "quantity",
        "seller_id",
        "subscription_date",
        "variant_id",
      ].sort()
    )
    expect(created().period).toBe(12)
  })
})

// ---------------------------------------------------------------------------
describe("withdrawAutoRenew (disable_auto_renew)", () => {
  const NOW = new Date("2026-10-10T00:00:00.000Z")

  it("keeps access to the end of the paid period, then nothing is scheduled", async () => {
    const svc = makeSubscriptionService([row()])
    const out = await svc.withdrawAutoRenew("sub_1", NOW)
    expect(out.status).toBe(SubscriptionStatus.ACTIVE)
    expect(out.auto_renew_approved).toBe(false)
    expect(new Date(out.expiration_date as Date).toISOString()).toBe("2026-11-01T00:00:00.000Z")
    expect(out.next_order_date).toBeNull()
    expect((out.metadata as Record<string, unknown>).auto_renew_withdrawn_at).toBe(NOW.toISOString())
    expect((out.metadata as Record<string, unknown>).auto_renew_mode).toBe("withdrawn")
    expect((out.metadata as Record<string, unknown>).initial_order_id).toBe("order_0")
  })

  it("a fixed-term subscription has nothing to withdraw", async () => {
    const svc = makeSubscriptionService([
      row({ expiration_date: new Date("2027-10-01T00:00:00.000Z"), auto_renew_approved: false }),
    ])
    const err = await svc.withdrawAutoRenew("sub_1", NOW).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AutoRenewError)
    expect((err as AutoRenewError).code).toBe("auto_renew_not_on")
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("refused off ACTIVE/PAUSED", async () => {
    const svc = makeSubscriptionService([row({ status: SubscriptionStatus.PAST_DUE })])
    await expect(svc.withdrawAutoRenew("sub_1", NOW)).rejects.toBeInstanceOf(
      SubscriptionTransitionError
    )
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe("approveAutoRenew (re-approval)", () => {
  const NOW = new Date("2026-10-10T00:00:00.000Z")
  const single = () =>
    row({
      auto_renew_approved: false,
      next_order_date: null,
      expiration_date: new Date("2026-11-01T00:00:00.000Z"),
    })

  it("needs the CURRENT disclosure version; a stale one writes nothing", async () => {
    const svc = makeSubscriptionService([single()])
    const err = await svc
      .approveAutoRenew("sub_1", {
        disclosure_version: "2026-01-01",
        product_allows_until_canceled: true,
        now: NOW,
      })
      .catch((e: unknown) => e)
    expect((err as AutoRenewError).code).toBe("auto_renew_disclosure_outdated")
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("the PURCHASE disclosure version is not a re-approval (its wording differs)", async () => {
    const svc = makeSubscriptionService([single()])
    const err = await svc
      .approveAutoRenew("sub_1", {
        disclosure_version: AUTO_RENEW_DISCLOSURE_VERSION,
        product_allows_until_canceled: true,
        now: NOW,
      })
      .catch((e: unknown) => e)
    expect((err as AutoRenewError).code).toBe("auto_renew_disclosure_outdated")
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })

  it("with the current version: until cancelled again, stamped, next charge at the paid period end", async () => {
    const svc = makeSubscriptionService([single()])
    const out = await svc.approveAutoRenew("sub_1", {
      disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
      product_allows_until_canceled: true,
      now: NOW,
    })
    expect(out.auto_renew_approved).toBe(true)
    expect(out.auto_renew_approved_at).toEqual(NOW)
    expect(out.auto_renew_disclosure_version).toBe(AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION)
    expect(out.expiration_date).toBeNull()
    expect((out.metadata as Record<string, unknown>).auto_renew_mode).toBe("until_canceled")
    expect(new Date(out.next_order_date as Date).toISOString()).toBe("2026-11-01T00:00:00.000Z")
  })

  it.each([
    ["auto_renew_not_offered", { product_allows_until_canceled: false }, {}],
    ["auto_renew_payment_method_required", {}, { payment_method_id: null }],
    ["auto_renew_not_available", {}, { next_order_date: new Date("2026-11-01T00:00:00.000Z") }],
    ["auto_renew_not_available", {}, { expiration_date: new Date("2026-10-09T00:00:00.000Z") }],
  ])("refuses with %s", async (code, argOverrides, rowOverrides) => {
    const svc = makeSubscriptionService([{ ...single(), ...rowOverrides }])
    const err = await svc
      .approveAutoRenew("sub_1", {
        disclosure_version: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
        product_allows_until_canceled: true,
        now: NOW,
        ...argOverrides,
      })
      .catch((e: unknown) => e)
    expect((err as AutoRenewError).code).toBe(code)
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe("the renewal job respects a withdrawn approval", () => {
  function jobSetup(rows: FakeRow[]) {
    const svc = makeSubscriptionService(rows)
    const entitlements = {
      extendBySubscriptionId: jest.fn(async () => 0),
      revokeBySubscriptionId: jest.fn(async () => 0),
      grantFromSubscription: jest.fn(async () => ({ id: "ent" })),
    }
    const container = makeContainer({
      [SUBSCRIPTION_MODULE]: svc,
      [ENTITLEMENT_MODULE]: entitlements,
      [Modules.EVENT_BUS]: { emit: jest.fn(async () => undefined) },
      [ContainerRegistrationKeys.QUERY]: { graph: jest.fn(async () => ({ data: [] })) },
    }) as unknown as MedusaContainer
    return { svc, entitlements, container }
  }

  it.each([["live", "1"], ["legacy", undefined]])(
    "%s mode: before the period end nothing is charged and access stays; after it, the seat expires",
    async (_mode, live) => {
      process.env[FLAG] = "true"
      if (live) process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = live
      const now = Date.now()
      // Approved seat whose cycle is due right now.
      const { svc, entitlements, container } = jobSetup([
        row({
          last_order_date: new Date(now - 20 * DAY),
          next_order_date: new Date(now - 60_000),
        }),
      ])
      await svc.withdrawAutoRenew("sub_1", new Date(now))
      const ends = new Date(svc.store.get("sub_1")?.expiration_date as Date)
      expect(ends.getTime()).toBeGreaterThan(now)

      await processSubscriptionRenewals(container)
      expect(renewRun).not.toHaveBeenCalled()
      expect(svc.store.get("sub_1")?.status).toBe(SubscriptionStatus.ACTIVE)
      expect(svc.store.get("sub_1")?.last_order_date).toEqual(new Date(now - 20 * DAY))
      expect(entitlements.revokeBySubscriptionId).not.toHaveBeenCalled()

      // The paid period ends.
      svc.store.set("sub_1", {
        ...(svc.store.get("sub_1") as FakeRow),
        expiration_date: new Date(Date.now() - 1000),
      })
      await processSubscriptionRenewals(container)
      expect(renewRun).not.toHaveBeenCalled()
      expect(svc.store.get("sub_1")?.status).toBe(SubscriptionStatus.EXPIRED)
      expect(entitlements.revokeBySubscriptionId).toHaveBeenCalledWith("sub_1", "subscription_expired")
    }
  )
})

// ---------------------------------------------------------------------------
describe("saveAutoRenewPaymentMethod: the card is kept only for an approved subscription", () => {
  function pmSetup() {
    const svc = makeSubscriptionService([row({ payment_method_id: null })])
    const query = {
      graph: jest.fn(async () => ({
        data: [
          {
            id: "cart_1",
            payment_collection: {
              payment_sessions: [
                { id: "ps_old", status: "pending", data: {} },
                { id: "ps_1", status: "authorized", data: { id: "pi_1", payment_method: "pm_card" } },
              ],
            },
          },
        ],
      })),
    }
    const container = makeContainer({
      [SUBSCRIPTION_MODULE]: svc,
      [ContainerRegistrationKeys.QUERY]: query,
    }) as unknown as MedusaContainer
    return { svc, query, container }
  }

  it("approved and until cancelled: payment_method_id written from the authorized session", async () => {
    const { svc, container } = pmSetup()
    const out = await saveAutoRenewPaymentMethod(container, {
      subscription: { id: "sub_1", auto_renew_approved: true, expiration_date: null },
      cart_id: "cart_1",
    })
    expect(out).toEqual({ saved: true, payment_method_id: "pm_card" })
    expect(svc.store.get("sub_1")?.payment_method_id).toBe("pm_card")
  })

  it.each([
    ["declined", { auto_renew_approved: false, expiration_date: new Date() }],
    ["one period", { auto_renew_approved: false, expiration_date: null }],
    ["approved flag but a fixed end", { auto_renew_approved: true, expiration_date: new Date() }],
  ])("%s: nothing looked up, nothing written", async (_label, sub) => {
    const { svc, query, container } = pmSetup()
    const out = await saveAutoRenewPaymentMethod(container, {
      subscription: { id: "sub_1", ...sub },
      cart_id: "cart_1",
    })
    expect(out).toEqual({ saved: false, reason: "not_approved" })
    expect(query.graph).not.toHaveBeenCalled()
    expect(svc.updateSubscriptions).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
describe("no approval, no renewal: pause → resume cannot schedule a charge", () => {
  // Jan 30 + 1 month (setMonth) overflows to Mar 2, while Feb 1 + 1 month is
  // Mar 1 — so before the fix a resume on Feb 1 scheduled Mar 1, inside the
  // paid period, and the job charged it.
  const START = new Date("2027-01-30T12:00:00.000Z")
  const RESUME_AT = new Date("2027-02-01T12:00:00.000Z")
  const DUE_AT = new Date("2027-03-01T13:00:00.000Z")

  function jobDeps(svc: ReturnType<typeof makeSubscriptionService>) {
    const entitlements = {
      extendBySubscriptionId: jest.fn(async () => 0),
      revokeBySubscriptionId: jest.fn(async () => 0),
      grantFromSubscription: jest.fn(async () => ({ id: "ent" })),
    }
    const container = makeContainer({
      [SUBSCRIPTION_MODULE]: svc,
      [ENTITLEMENT_MODULE]: entitlements,
      [Modules.EVENT_BUS]: { emit: jest.fn(async () => undefined) },
      [ContainerRegistrationKeys.QUERY]: { graph: jest.fn(async () => ({ data: [] })) },
    }) as unknown as MedusaContainer
    return { entitlements, container }
  }

  async function singlePeriodRow() {
    const svc = makeSubscriptionService([])
    const created = (await svc.createSubscriptions({
      customer_id: "cus_1",
      product_id: "prod_1",
      seller_id: "sel_1",
      interval: SubscriptionInterval.MONTHLY,
      period: 12,
      subscription_date: START,
      single_period: true,
      auto_renew_approved: false,
      metadata: { initial_order_id: "order_0" },
    } as never)) as unknown as FakeRow[]
    const r = { ...created[0], id: "sub_1", status: SubscriptionStatus.ACTIVE } as FakeRow
    svc.store.set("sub_1", r)
    return svc
  }

  async function withdrawnRow() {
    const svc = makeSubscriptionService([
      row({ last_order_date: START, next_order_date: new Date("2027-03-02T12:00:00.000Z") }),
    ])
    await svc.withdrawAutoRenew("sub_1", new Date("2027-01-31T12:00:00.000Z"))
    return svc
  }

  afterEach(() => {
    jest.useRealTimers()
  })

  it.each([
    ["one period (no approval)", singlePeriodRow],
    ["withdrawn approval", withdrawnRow],
  ])("%s: resume keeps next_order_date NULL and the live job never charges", async (_label, make) => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    const svc = await make()
    const expiration = new Date(svc.store.get("sub_1")?.expiration_date as Date)
    expect(expiration.toISOString()).toBe("2027-03-02T12:00:00.000Z")
    expect(svc.store.get("sub_1")?.next_order_date).toBeNull()

    jest.useFakeTimers({ now: RESUME_AT, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] })
    await svc.pauseSubscription("sub_1")
    const resumed = await svc.resumeSubscription("sub_1")
    expect(resumed.status).toBe(SubscriptionStatus.ACTIVE)
    expect(resumed.next_order_date).toBeNull()

    jest.setSystemTime(DUE_AT)
    const { container } = jobDeps(svc)
    await processSubscriptionRenewals(container)
    expect(renewRun).not.toHaveBeenCalled()
    expect(svc.store.get("sub_1")?.last_order_date).toEqual(
      svc.store.get("sub_1")?.subscription_date ?? START
    )
  })

  it("defence in depth: a marked row the job would otherwise see as due is not charged", async () => {
    process.env[FLAG] = "true"
    process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"
    const svc = await singlePeriodRow()
    // Simulate any other path that wrote a next order onto it.
    svc.store.set("sub_1", {
      ...(svc.store.get("sub_1") as FakeRow),
      next_order_date: new Date(Date.now() - 60_000),
      expiration_date: new Date(Date.now() + 10 * DAY),
    })
    expect(await svc.getDueSubscriptions()).toHaveLength(0)
    const { container } = jobDeps(svc)
    await processSubscriptionRenewals(container)
    expect(renewRun).not.toHaveBeenCalled()
  })

  it("a re-approved row is due again (the marker is not a permanent block)", async () => {
    const svc = makeSubscriptionService([
      row({
        next_order_date: new Date(Date.now() - 60_000),
        metadata: { auto_renew_mode: "until_canceled" },
      }),
    ])
    expect(await svc.getDueSubscriptions()).toHaveLength(1)
  })

  it("a legacy row with nothing scheduled still resumes with a next order (unchanged)", async () => {
    const svc = makeSubscriptionService([
      row({
        status: SubscriptionStatus.PAUSED,
        auto_renew_approved: false,
        expiration_date: new Date(Date.now() + 365 * DAY),
        next_order_date: null,
        metadata: {},
      }),
    ])
    const out = await svc.resumeSubscription("sub_1")
    expect(out.next_order_date).toBeInstanceOf(Date)
  })

  it("a PAUSED one-period row past its paid period is expired by the flagged sweep (and only with the flag)", async () => {
    const make = async () => {
      const svc = await singlePeriodRow()
      svc.store.set("sub_1", {
        ...(svc.store.get("sub_1") as FakeRow),
        status: SubscriptionStatus.PAUSED,
        paused_at: new Date(Date.now() - 5 * DAY),
        expiration_date: new Date(Date.now() - 1000),
      })
      return svc
    }

    const off = await make()
    await processSubscriptionRenewals(jobDeps(off).container)
    expect(off.store.get("sub_1")?.status).toBe(SubscriptionStatus.PAUSED)

    process.env[FLAG] = "true"
    const on = await make()
    const deps = jobDeps(on)
    await processSubscriptionRenewals(deps.container)
    expect(on.store.get("sub_1")?.status).toBe(SubscriptionStatus.EXPIRED)
    expect(deps.entitlements.revokeBySubscriptionId).toHaveBeenCalledWith("sub_1", "subscription_expired")
  })
})
