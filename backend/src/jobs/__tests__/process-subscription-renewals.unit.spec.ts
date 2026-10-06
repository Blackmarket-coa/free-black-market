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
import EntitlementModuleService from "../../modules/entitlement/service"
import {
  EntitlementKind,
  EntitlementSource,
  EntitlementStatus,
} from "../../modules/entitlement/models"
import {
  READ_EXPORT_FEATURE_KEY,
  grantReadExportEntitlement,
} from "../../workflows/subscription/grace-lifecycle"
import {
  SUBSCRIPTION_EXPIRED_EVENT,
  emitSubscriptionExpired,
  subscriptionExpiredPayload,
} from "../../workflows/subscription/subscription-expired"

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

describe("subscription.expired (BM-5): every expiry site publishes it while FF_BLACK_MASK_PROVISIONING_V1 is on", () => {
  const BM_FLAG = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1
  // A fixed expiration, so occurred_at can be compared exactly: it must be the
  // row's expiration_date, never the run's clock.
  const EXP = new Date(Date.now() - 3 * DAY)

  afterEach(() => {
    delete process.env[BM_FLAG]
  })

  const expiredEmits = (eventBus: { emit: jest.Mock }) =>
    eventBus.emit.mock.calls
      .map((c) => c[0] as { name: string; data: Record<string, unknown> })
      .filter((e) => e.name === SUBSCRIPTION_EXPIRED_EVENT)

  it("the per-subscription expire (a due ACTIVE row past expiration) publishes with occurred_at = the row's expiration_date", async () => {
    process.env[BM_FLAG] = "true"
    const { svc, eventBus, container } = setup([row({ id: "due_exp", expiration_date: EXP })])
    const expireSpy = jest.spyOn(svc, "expireSubscription")
    await processSubscriptionRenewals(container)

    expect(svc.store.get("due_exp")?.status).toBe(SubscriptionStatus.EXPIRED)
    // Expired by the per-subscription site, so the ACTIVE sweep no longer
    // sees it: exactly one publish.
    expect(expireSpy).toHaveBeenCalledWith("due_exp")
    expect(expiredEmits(eventBus)).toEqual([
      { name: "subscription.expired", data: { subscription_id: "due_exp", occurred_at: EXP.toISOString() } },
    ])
  })

  it("the ACTIVE batch sweep (not due, past expiration) publishes for each row it expires", async () => {
    process.env[BM_FLAG] = "true"
    const exp2 = new Date(EXP.getTime() - DAY)
    const { svc, eventBus, container } = setup([
      row({ id: "lapsed", next_order_date: null, expiration_date: EXP }),
      row({ id: "lapsed2", next_order_date: null, expiration_date: exp2 }),
      row({ id: "live", next_order_date: null }),
    ])
    const expireSpy = jest.spyOn(svc, "expireSubscription")
    await processSubscriptionRenewals(container)

    expect(expireSpy).toHaveBeenCalledWith(["lapsed", "lapsed2"])
    expect(expiredEmits(eventBus).map((e) => e.data)).toEqual([
      { subscription_id: "lapsed", occurred_at: EXP.toISOString() },
      { subscription_id: "lapsed2", occurred_at: exp2.toISOString() },
    ])
    expect(svc.store.get("live")?.status).toBe(SubscriptionStatus.ACTIVE)
  })

  it("the paused-past-paid-period sweep (withdrawn auto-renew) publishes too", async () => {
    process.env[BM_FLAG] = "true"
    process.env[FLAG] = "true"
    const { svc, eventBus, container } = setup([
      row({
        id: "withdrawn",
        status: SubscriptionStatus.PAUSED,
        next_order_date: null,
        expiration_date: EXP,
        metadata: { auto_renew_mode: "withdrawn" },
      }),
    ])
    await processSubscriptionRenewals(container)

    expect(svc.store.get("withdrawn")?.status).toBe(SubscriptionStatus.EXPIRED)
    expect(expiredEmits(eventBus).map((e) => e.data)).toEqual([
      { subscription_id: "withdrawn", occurred_at: EXP.toISOString() },
    ])
  })

  it("flag off: every site still expires, nothing is published; the flag is read per run", async () => {
    const rows = [
      row({ id: "due_exp", expiration_date: EXP }),
      row({ id: "lapsed", next_order_date: null, expiration_date: EXP }),
    ]
    const off = setup(rows)
    await processSubscriptionRenewals(off.container)
    expect(off.svc.store.get("due_exp")?.status).toBe(SubscriptionStatus.EXPIRED)
    expect(off.svc.store.get("lapsed")?.status).toBe(SubscriptionStatus.EXPIRED)
    expect(expiredEmits(off.eventBus)).toEqual([])

    // Same module instance, flag flipped between runs: the next run publishes.
    process.env[BM_FLAG] = "true"
    const on = setup(rows)
    await processSubscriptionRenewals(on.container)
    expect(expiredEmits(on.eventBus).map((e) => e.data.subscription_id)).toEqual(["due_exp", "lapsed"])
  })

  it("a publish failure never undoes or blocks the expiry write (legacy mode would otherwise mark it FAILED)", async () => {
    process.env[BM_FLAG] = "true"
    const { svc, eventBus, entitlements, container } = setup([
      row({ id: "due_exp", expiration_date: EXP }),
      row({ id: "lapsed", next_order_date: null, expiration_date: EXP }),
      row({ id: "due" }),
    ])
    eventBus.emit.mockRejectedValue(new Error("event bus down"))
    const failSpy = jest.spyOn(svc, "failSubscription")
    await processSubscriptionRenewals(container)

    expect(svc.store.get("due_exp")?.status).toBe(SubscriptionStatus.EXPIRED)
    expect(svc.store.get("lapsed")?.status).toBe(SubscriptionStatus.EXPIRED)
    expect(failSpy).not.toHaveBeenCalled()
    expect(entitlements.revokeBySubscriptionId).toHaveBeenCalledWith("due_exp", "subscription_expired")
    expect(entitlements.revokeBySubscriptionId).toHaveBeenCalledWith("lapsed", "subscription_expired")
    // The loop went on to the next row.
    expect(svc.store.get("due")?.last_order_date).not.toEqual(row().last_order_date)
    expect(expiredEmits(eventBus)).toHaveLength(2)
  })
})

describe("subscription.expired payload", () => {
  const BM_FLAG = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1
  afterEach(() => {
    delete process.env[BM_FLAG]
  })

  it("a row with no (or an unparseable) expiration_date publishes nothing, resolves nothing, and logs", async () => {
    process.env[BM_FLAG] = "true"
    const { eventBus, container } = setup([])
    const resolve = (container as unknown as { resolve: jest.Mock }).resolve
    expect(await emitSubscriptionExpired(container, { id: "s", expiration_date: null })).toBe("no_expiration_date")
    expect(await emitSubscriptionExpired(container, { id: "s" })).toBe("no_expiration_date")
    expect(await emitSubscriptionExpired(container, { id: "s", expiration_date: "not a date" })).toBe(
      "no_expiration_date"
    )
    expect(resolve).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
    expect(logSpies[1]).toHaveBeenCalled()
  })

  it("flag off resolves nothing; the payload is the row's expiration_date as ISO", async () => {
    const { container } = setup([])
    expect(await emitSubscriptionExpired(container, { id: "s", expiration_date: new Date(1) })).toBe("flag_off")
    expect((container as unknown as { resolve: jest.Mock }).resolve).not.toHaveBeenCalled()
    expect(subscriptionExpiredPayload({ id: "s", expiration_date: "2026-03-01T00:00:00.000Z" })).toEqual({
      subscription_id: "s",
      occurred_at: "2026-03-01T00:00:00.000Z",
    })
  })
})

// ---------------------------------------------------------------------------
// F4 on expiry: read-only access with export (docs/BLACK_MASK_LAUNCH_PLAN.md
// §5 F4). Real code: the job, grace-lifecycle's grantReadExportEntitlement,
// and the REAL EntitlementModuleService prototype (grant's idempotency guard,
// revokeBySubscriptionId) over an in-memory table; only its three generated
// data-access methods are stubbed.
// ---------------------------------------------------------------------------
describe("expiry keeps read/export (FF_CONSUMER_SUBSCRIPTIONS_V1)", () => {
  type EntRow = Record<string, unknown> & { id: string }

  function makeEntitlements(seed: EntRow[]) {
    const table: EntRow[] = seed.map((r) => ({ ...r }))
    const target: Record<string, unknown> = {
      table,
      listEntitlements: jest.fn(async (filter: Record<string, unknown> = {}) =>
        table
          .filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v))
          .map((r) => ({ ...r }))
      ),
      createEntitlements: jest.fn(async (data: Array<Record<string, unknown>>) =>
        data.map((d) => {
          const created = { id: `ent_${table.length + 1}`, ...d }
          table.push(created)
          return { ...created }
        })
      ),
      updateEntitlements: jest.fn(async (data: Array<Record<string, unknown> & { id: string }>) =>
        data.map((d) => {
          const found = table.find((r) => r.id === d.id)
          if (!found) throw new Error(`no entitlement ${d.id}`)
          Object.assign(found, d)
          return { ...found }
        })
      ),
    }
    const proto = EntitlementModuleService.prototype as unknown as Record<string, unknown>
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || name in target) continue
      const fn = proto[name]
      if (typeof fn === "function") target[name] = (fn as (...a: unknown[]) => unknown).bind(target)
    }
    return target as unknown as EntitlementModuleService & {
      table: EntRow[]
      createEntitlements: jest.Mock
    }
  }

  function setupReal(rows: FakeRow[]) {
    const svc = makeSubscriptionService(rows)
    // Every subscription starts with an ACTIVE tier grant the expiry revokes.
    const entitlements = makeEntitlements(
      rows.map((r, i) => ({
        id: `seed_${i}`,
        source_subscription_id: r.id,
        seller_id: r.seller_id,
        customer_id: r.customer_id,
        feature_key: "features.vault",
        status: EntitlementStatus.ACTIVE,
        expires_at: new Date(Date.now() + DAY),
      }))
    )
    const grantSpy = jest.spyOn(entitlements, "grantFromSubscription")
    const container = makeContainer({
      [SUBSCRIPTION_MODULE]: svc,
      [ENTITLEMENT_MODULE]: entitlements,
      [Modules.EVENT_BUS]: { emit: jest.fn(async () => undefined) },
      [ContainerRegistrationKeys.QUERY]: { graph: jest.fn(async () => ({ data: [] })) },
    }) as unknown as MedusaContainer
    return { svc, entitlements, grantSpy, container }
  }

  const EXP = new Date(Date.now() - 3 * DAY)
  // One row per expiry site: the per-subscription expire (due ACTIVE past its
  // expiration), the ACTIVE batch sweep (not due), and the PAUSED never-renews
  // sweep (withdrawn auto-renew).
  const sites = () => [
    row({ id: "due_exp", expiration_date: EXP, customer_id: "cus_a", seller_id: "sel_a" }),
    row({ id: "lapsed", next_order_date: null, expiration_date: EXP, customer_id: "cus_b", seller_id: "sel_b" }),
    row({
      id: "withdrawn",
      status: SubscriptionStatus.PAUSED,
      next_order_date: null,
      expiration_date: EXP,
      customer_id: "cus_c",
      seller_id: "sel_c",
      metadata: { auto_renew_mode: "withdrawn" },
    }),
  ]
  const readExport = (table: EntRow[], id: string) =>
    table.filter((r) => r.source_subscription_id === id && r.feature_key === READ_EXPORT_FEATURE_KEY)

  it("flag on: every expiry site revokes features.* and grants read/export once, as read-only does", async () => {
    process.env[FLAG] = "true"
    const { svc, entitlements, grantSpy, container } = setupReal(sites())
    await processSubscriptionRenewals(container)

    for (const [id, customer, seller] of [
      ["due_exp", "cus_a", "sel_a"],
      ["lapsed", "cus_b", "sel_b"],
      ["withdrawn", "cus_c", "sel_c"],
    ]) {
      expect(svc.store.get(id)?.status).toBe(SubscriptionStatus.EXPIRED)
      const granted = readExport(entitlements.table, id)
      expect(granted).toHaveLength(1)
      expect(granted[0]).toMatchObject({
        status: EntitlementStatus.ACTIVE,
        kind: EntitlementKind.ACCESS_PASS,
        source: EntitlementSource.SUBSCRIPTION,
        expires_at: null,
        customer_id: customer,
        seller_id: seller,
      })
      // The tier grant is revoked (a status change; the row is kept).
      const tier = entitlements.table.find((r) => r.source_subscription_id === id && r.feature_key === "features.vault")
      expect(tier).toMatchObject({ status: EntitlementStatus.REVOKED, revoked_reason: "subscription_expired" })
    }
    expect(grantSpy).toHaveBeenCalledTimes(3)
  })

  it("flag off: every site still expires and revokes, nothing is granted", async () => {
    const { svc, entitlements, grantSpy, container } = setupReal(sites())
    await processSubscriptionRenewals(container)

    expect(svc.store.get("due_exp")?.status).toBe(SubscriptionStatus.EXPIRED)
    expect(svc.store.get("lapsed")?.status).toBe(SubscriptionStatus.EXPIRED)
    // The paused sweep is flag-on only: the paused row is untouched, as before.
    expect(svc.store.get("withdrawn")?.status).toBe(SubscriptionStatus.PAUSED)
    expect(grantSpy).not.toHaveBeenCalled()
    expect(entitlements.createEntitlements).not.toHaveBeenCalled()
    expect(entitlements.table.filter((r) => r.feature_key === READ_EXPORT_FEATURE_KEY)).toEqual([])
    expect(entitlements.table.filter((r) => r.status === EntitlementStatus.REVOKED).map((r) => r.source_subscription_id)).toEqual([
      "due_exp",
      "lapsed",
    ])
  })

  it("a grant failure is logged and never undoes the expiry; the loop goes on", async () => {
    process.env[FLAG] = "true"
    const { svc, entitlements, grantSpy, container } = setupReal([...sites(), row({ id: "due" })])
    grantSpy.mockRejectedValue(new Error("entitlement db down"))
    await processSubscriptionRenewals(container)

    for (const id of ["due_exp", "lapsed", "withdrawn"]) {
      expect(svc.store.get(id)?.status).toBe(SubscriptionStatus.EXPIRED)
      expect(readExport(entitlements.table, id)).toEqual([])
    }
    expect(grantSpy).toHaveBeenCalledTimes(3)
    expect(
      logSpies[2].mock.calls.some((c) => String(c[0]).includes("Failed to grant read/export to expired subscription due_exp"))
    ).toBe(true)
    // The next due row was still processed (legacy date bump).
    expect(svc.store.get("due")?.last_order_date).not.toEqual(row().last_order_date)
  })

  it("a re-run (and an expiry redelivered to the same row) does not duplicate the grant", async () => {
    process.env[FLAG] = "true"
    const { svc, entitlements, container } = setupReal(sites())
    await processSubscriptionRenewals(container)
    await processSubscriptionRenewals(container)
    const createdAfterTwoRuns = entitlements.createEntitlements.mock.calls.length
    expect(createdAfterTwoRuns).toBe(3)

    // The same row reaches an expiry site again (a retried write): revoke then
    // grant reactivates the one read/export row instead of adding another.
    svc.store.set("lapsed", { ...(svc.store.get("lapsed") as FakeRow), status: SubscriptionStatus.ACTIVE })
    await processSubscriptionRenewals(container)
    expect(entitlements.createEntitlements.mock.calls.length).toBe(createdAfterTwoRuns)
    for (const id of ["due_exp", "lapsed", "withdrawn"]) {
      const granted = readExport(entitlements.table, id)
      expect(granted).toHaveLength(1)
      expect(granted[0].status).toBe(EntitlementStatus.ACTIVE)
    }
  })

  it("the shared grant helper (read-only and expiry) writes one row however often it runs", async () => {
    process.env[FLAG] = "true"
    const ents = makeEntitlements([])
    await grantReadExportEntitlement(ents, { id: "s1", customer_id: "c1", seller_id: "x1" })
    await grantReadExportEntitlement(ents, { id: "s1", customer_id: "c1", seller_id: "x1" })
    expect(ents.table).toEqual([
      expect.objectContaining({
        source_subscription_id: "s1",
        feature_key: READ_EXPORT_FEATURE_KEY,
        kind: EntitlementKind.ACCESS_PASS,
        expires_at: null,
        status: EntitlementStatus.ACTIVE,
      }),
    ])
  })
})
