import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import {
  BLACKSTAR_SUBSCRIPTION_ID,
} from "../service"
import {
  BLACK_MASK_EVENTS,
  BLACK_MASK_FETCH_TIMEOUT_MS,
  BLACK_MASK_SUBSCRIPTION_ID,
  buildBlackMaskPayload,
  verifyBlackMaskSignature,
  type BlackMaskCustomerLookup,
  type BlackMaskStoredPayload,
} from "../black-mask"
import { CLAIM_SQL, makeHarness } from "./black-mask-harness"

/**
 * The Black Mask channel's service half against the REAL
 * MarketplaceWebhooksService (prototype + shadowed CRUD + a pg fake that runs
 * only the claim statement): enqueue gating and dedupe, the claim, the
 * send-time email, signing, timeout, the 8-attempt ladder, and isolation from
 * the existing channels' drain.
 */

const FLAG = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1
const URL = "https://bm.example/hooks/fbm"
const SECRET = "bm_unit_secret"
const KEY_ID = "bmk_2026_10"
const SELLER = "sel_bmc"
const ENV = [
  FLAG,
  "BLACK_MASK_PROVISIONING_URL",
  "BLACK_MASK_WEBHOOK_SECRET",
  "BLACK_MASK_WEBHOOK_KEY_ID",
  "BLACK_MASK_SELLER_ID",
  "BLACKSTAR_WEBHOOK_SECRET",
  "BLACKSTAR_API_BASE",
] as const

function enable() {
  process.env[FLAG] = "true"
  process.env.BLACK_MASK_PROVISIONING_URL = URL
  process.env.BLACK_MASK_WEBHOOK_SECRET = SECRET
  process.env.BLACK_MASK_WEBHOOK_KEY_ID = KEY_ID
  process.env.BLACK_MASK_SELLER_ID = SELLER
}

afterEach(() => {
  for (const k of ENV) delete process.env[k]
  jest.restoreAllMocks()
  jest.useRealTimers()
})

function payload(over: Partial<{ event: BlackMaskStoredPayload["event"]; id: string; seq: number; customer: string | null }> = {}) {
  const event = over.event ?? "placed"
  return buildBlackMaskPayload({
    event,
    subject: { type: event === "placed" || event === "cancelled" ? "order" : "subscription", id: over.id ?? "order_1" },
    sequence: over.seq ?? 1767225600000,
    customerId: over.customer === undefined ? "cus_1" : over.customer,
    plan: "vault_monthly",
    seats: 1,
    sellerId: SELLER,
  })
}

type Captured = { url: string; init: RequestInit & { headers: Record<string, string>; body: string } }

function mockFetch(respond: () => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>) {
  const calls: Captured[] = []
  jest.spyOn(global, "fetch").mockImplementation((async (url: string, init: Captured["init"]) => {
    calls.push({ url, init })
    return respond()
  }) as unknown as typeof fetch)
  return calls
}

const ok202 = async () => ({ ok: true, status: 202, text: async () => "{}" })
const fail500 = async () => ({ ok: false, status: 500, text: async () => "down" })

const lookup = (customer: { email?: string | null; metadata?: unknown } | null) => {
  const fn = jest.fn<ReturnType<BlackMaskCustomerLookup>, Parameters<BlackMaskCustomerLookup>>(
    async () => customer
  )
  return fn
}

describe("emitBlackMask (enqueue)", () => {
  it("writes nothing while the flag is off, even fully configured", async () => {
    enable()
    delete process.env[FLAG]
    const { svc, rows } = makeHarness()
    expect(await svc.emitBlackMask(payload())).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it("writes nothing while the config is incomplete", async () => {
    enable()
    delete process.env.BLACK_MASK_WEBHOOK_KEY_ID
    const { svc, rows } = makeHarness()
    expect(await svc.emitBlackMask(payload())).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it("enqueues one pending row on the Black Mask sentinel with the payload stored verbatim (no email)", async () => {
    enable()
    const { svc, rows } = makeHarness()
    const p = payload()
    const d = await svc.emitBlackMask(p)
    expect(d).toEqual({ id: "whd_1", subscription_id: BLACK_MASK_SUBSCRIPTION_ID })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      subscription_id: BLACK_MASK_SUBSCRIPTION_ID,
      event: "black_mask.placed",
      event_id: p.event_id,
      status: "pending",
      attempt: 0,
    })
    expect(rows[0].payload).toEqual(p)
    expect(JSON.stringify(rows[0])).not.toMatch(/email/i)
  })

  it("a duplicate enqueue of the same (subject, event, sequence) is a no-op returning the first row", async () => {
    enable()
    const { svc, rows } = makeHarness()
    const a = await svc.emitBlackMask(payload())
    const b = await svc.emitBlackMask(payload())
    expect(rows).toHaveLength(1)
    expect(b?.id).toBe(a?.id)
    // A later transition of the same subject is a different key.
    await svc.emitBlackMask(payload({ event: "cancelled", seq: 1767225700000 }))
    expect(rows).toHaveLength(2)
  })

  it("two racing enqueues of one key: the unique index refuses the second and it returns the winner", async () => {
    enable()
    const { svc, rows } = makeHarness()
    const [a, b] = await Promise.all([svc.emitBlackMask(payload()), svc.emitBlackMask(payload())])
    expect(rows).toHaveLength(1)
    expect(a?.id).toBe(rows[0].id)
    expect(b?.id).toBe(rows[0].id)
  })

  it("refuses an event_id that did not come from the record", async () => {
    enable()
    const { svc, rows } = makeHarness()
    await expect(svc.emitBlackMask({ ...payload(), event_id: "bm:v1:whatever" })).rejects.toThrow(/does not match its record/)
    expect(rows).toHaveLength(0)
  })
})

describe("drainBlackMaskDeliveries (send)", () => {
  it("sends `placed` with the email resolved at send time; the stored row never holds it", async () => {
    enable()
    const { svc, rows, sql } = makeHarness()
    await svc.emitBlackMask(payload())
    const calls = mockFetch(ok202)
    const find = lookup({ email: "member@example.org", metadata: {} })

    const result = await svc.drainBlackMaskDeliveries({ lookupCustomer: find })

    expect(result).toEqual({ attempted: 1, sent: 1 })
    expect(find).toHaveBeenCalledWith("cus_1")
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(URL)
    const body = JSON.parse(calls[0].init.body)
    expect(body.customer_email).toBe("member@example.org")
    expect(body.event_id).toBe(rows[0].event_id)
    expect(JSON.stringify(rows[0])).not.toMatch(/member@example\.org|email/i)
    expect(rows[0]).toMatchObject({ status: "succeeded", attempt: 1, response_code: 202, next_attempt_at: null })
    // It went through the claim.
    expect(sql).toHaveLength(1)
    expect(sql[0]).toMatch(CLAIM_SQL)
  })

  it("signs `{timestamp}.{raw_body}` with the secret and sends the four contract headers", async () => {
    enable()
    const { svc } = makeHarness()
    await svc.emitBlackMask(payload())
    const calls = mockFetch(ok202)
    await svc.drainBlackMaskDeliveries({ lookupCustomer: lookup({ email: "member@example.org" }) })

    const h = calls[0].init.headers
    expect(h["content-type"]).toBe("application/json")
    expect(h["X-FBM-Key-Id"]).toBe(KEY_ID)
    expect(h["X-FBM-Event-Id"]).toBe(payload().event_id)
    expect(h["X-FBM-Timestamp"]).toMatch(/^\d+$/)
    expect(
      verifyBlackMaskSignature({
        secret: SECRET,
        timestamp: h["X-FBM-Timestamp"],
        rawBody: calls[0].init.body,
        signature: h["X-FBM-Signature"],
      })
    ).toBe(true)
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it("omits the email for a synthetic Blackout customer", async () => {
    enable()
    const { svc } = makeHarness()
    await svc.emitBlackMask(payload())
    const calls = mockFetch(ok202)
    await svc.drainBlackMaskDeliveries({
      lookupCustomer: lookup({ email: "blackout+u1@users.blackout.invalid", metadata: { synthetic_email: true } }),
    })
    expect(JSON.parse(calls[0].init.body).customer_email).toBeUndefined()
  })

  it("never looks up or sends an email on any event but `placed`", async () => {
    enable()
    const { svc } = makeHarness()
    // Every event but `placed`, read from the contract's own list so a new
    // event (e.g. `expired`) is covered the day it is added.
    const others = BLACK_MASK_EVENTS.filter((e) => e !== "placed")
    expect(others).toContain("expired")
    for (const [i, event] of others.entries()) {
      await svc.emitBlackMask(payload({ event, id: `sub_${i}` }))
    }
    const calls = mockFetch(ok202)
    const find = lookup({ email: "member@example.org" })
    const result = await svc.drainBlackMaskDeliveries({ lookupCustomer: find })
    expect(result.sent).toBe(others.length)
    expect(find).not.toHaveBeenCalled()
    for (const c of calls) expect(c.init.body).not.toMatch(/email/i)
  })

  it("a failed customer lookup on `placed` is a retry, not a send without the invite", async () => {
    enable()
    const { svc, rows } = makeHarness()
    await svc.emitBlackMask(payload())
    const calls = mockFetch(ok202)
    await svc.drainBlackMaskDeliveries({
      lookupCustomer: async () => {
        throw new Error("db down")
      },
    })
    expect(calls).toHaveLength(0)
    expect(rows[0]).toMatchObject({ status: "failed", attempt: 1, response_body: "customer_lookup_failed" })
  })

  it("two concurrent drains send each row exactly once (the claim)", async () => {
    enable()
    const { svc, rows } = makeHarness()
    await svc.emitBlackMask(payload({ id: "order_a" }))
    await svc.emitBlackMask(payload({ id: "order_b" }))

    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const calls = mockFetch(async () => {
      await gate
      return { ok: true, status: 202, text: async () => "{}" }
    })
    const find = lookup({ email: "member@example.org" })

    const drains = Promise.all([
      svc.drainBlackMaskDeliveries({ lookupCustomer: find }),
      svc.drainBlackMaskDeliveries({ lookupCustomer: find }),
    ])
    // Let both drains list both rows and race for the claims before any send returns.
    await new Promise((r) => setImmediate(r))
    release()
    const [first, second] = await drains

    expect(calls).toHaveLength(2)
    expect(calls.map((c) => JSON.parse(c.init.body).subject.id).sort()).toEqual(["order_a", "order_b"])
    expect(first.attempted + second.attempted).toBe(2)
    expect(rows.map((r) => [r.status, r.attempt])).toEqual([
      ["succeeded", 1],
      ["succeeded", 1],
    ])
  })

  it("a claimed (leased) row is not claimable again until the lease lapses", async () => {
    enable()
    const { svc, rows } = makeHarness()
    await svc.emitBlackMask(payload())
    mockFetch(fail500)
    await svc.drainBlackMaskDeliveries({ lookupCustomer: lookup(null) })
    expect(rows[0].status).toBe("failed")
    // Not due yet (1 minute rung): a second drain does nothing.
    const again = await svc.drainBlackMaskDeliveries({ lookupCustomer: lookup(null) })
    expect(again).toEqual({ attempted: 0, sent: 0 })
    expect(rows[0].attempt).toBe(1)
  })

  it("a timeout aborts the fetch and schedules the next rung", async () => {
    enable()
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] })
    const { svc, rows } = makeHarness()
    await svc.emitBlackMask(payload({ event: "cancelled" }))
    let sawAbort = false
    jest.spyOn(global, "fetch").mockImplementation(((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          sawAbort = true
          reject(new Error("This operation was aborted"))
        })
      })) as unknown as typeof fetch)

    const running = svc.drainBlackMaskDeliveries({ lookupCustomer: lookup(null) })
    await jest.advanceTimersByTimeAsync(BLACK_MASK_FETCH_TIMEOUT_MS)
    const result = await running

    expect(sawAbort).toBe(true)
    expect(result).toEqual({ attempted: 1, sent: 0 })
    expect(rows[0].status).toBe("failed")
    expect(rows[0].attempt).toBe(1)
    expect(rows[0].response_body).toBe("timeout")
    expect(rows[0].next_attempt_at!.getTime() - Date.now()).toBe(60_000)
  })

  it("climbs the 1m/5m/30m/2h/6h/12h/24h ladder and goes dead on the 8th failure", async () => {
    enable()
    const { svc, rows } = makeHarness()
    await svc.emitBlackMask(payload({ event: "renewed", id: "sub_1" }))
    const calls = mockFetch(fail500)
    const gaps: number[] = []
    for (let i = 1; i <= 8; i++) {
      // Make the row due, as the clock would.
      rows[0].next_attempt_at = new Date(Date.now() - 1)
      const before = Date.now()
      await svc.drainBlackMaskDeliveries({ lookupCustomer: lookup(null) })
      expect(rows[0].attempt).toBe(i)
      if (i < 8) {
        expect(rows[0].status).toBe("failed")
        gaps.push(Math.round((rows[0].next_attempt_at!.getTime() - before) / 60_000))
      }
    }
    expect(gaps).toEqual([1, 5, 30, 120, 360, 720, 1440])
    expect(rows[0]).toMatchObject({ status: "dead", attempt: 8, next_attempt_at: null, response_code: 500 })
    expect(calls).toHaveLength(8)

    // Dead rows are never picked up again.
    rows[0].next_attempt_at = new Date(Date.now() - 1)
    expect(await svc.drainBlackMaskDeliveries({ lookupCustomer: lookup(null) })).toEqual({ attempted: 0, sent: 0 })
    expect(calls).toHaveLength(8)
  })

  it("flag off or config gone at send time: no fetch, no claim, no attempt burned", async () => {
    enable()
    const { svc, rows, sql } = makeHarness()
    await svc.emitBlackMask(payload())
    const calls = mockFetch(ok202)

    delete process.env[FLAG]
    expect(await svc.drainBlackMaskDeliveries({ lookupCustomer: lookup(null) })).toEqual({ attempted: 0, sent: 0 })
    process.env[FLAG] = "true"
    delete process.env.BLACK_MASK_WEBHOOK_SECRET
    expect(await svc.drainBlackMaskDeliveries({ lookupCustomer: lookup(null) })).toEqual({ attempted: 0, sent: 0 })

    expect(calls).toHaveLength(0)
    expect(sql).toHaveLength(0)
    expect(rows[0]).toMatchObject({ status: "pending", attempt: 0 })
  })

  it("with no reachable pg connection nothing is claimed and nothing is sent", async () => {
    enable()
    const { svc, rows } = makeHarness({ withPg: false })
    await svc.emitBlackMask(payload())
    const calls = mockFetch(ok202)
    expect(await svc.drainBlackMaskDeliveries({ lookupCustomer: lookup(null) })).toEqual({ attempted: 0, sent: 0 })
    expect(calls).toHaveLength(0)
    expect(rows[0]).toMatchObject({ status: "pending", attempt: 0 })
  })
})

describe("isolation from the existing channels", () => {
  it("the shared drain never lists Black Mask rows, and attemptDelivery refuses one", async () => {
    enable()
    process.env.BLACKSTAR_WEBHOOK_SECRET = "bs"
    process.env.BLACKSTAR_API_BASE = "https://blackstar.example"
    const { svc, rows } = makeHarness()
    await svc.emitBlackMask(payload())
    await svc.emitBlackstar("order.created", { source_order_ref: "o1" }, { eventId: "bs_1" })
    const calls = mockFetch(ok202)

    const attempted = await svc.drainDueDeliveries(50)
    expect(attempted).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://blackstar.example/api/webhooks/freeblackmarket")
    expect(rows.find((r) => r.subscription_id === BLACKSTAR_SUBSCRIPTION_ID)?.status).toBe("succeeded")
    expect(rows.find((r) => r.subscription_id === BLACK_MASK_SUBSCRIPTION_ID)).toMatchObject({ status: "pending", attempt: 0 })

    expect(await svc.attemptDelivery(rows[0].id)).toBe(false)
    expect(calls).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "pending", attempt: 0 })
  })
})

describe("replayBlackMaskDelivery", () => {
  it("puts a dead row back to pending with a fresh ladder; refuses anything not dead or not Black Mask", async () => {
    enable()
    process.env.BLACKSTAR_WEBHOOK_SECRET = "bs"
    process.env.BLACKSTAR_API_BASE = "https://blackstar.example"
    const { svc, rows } = makeHarness()
    await svc.emitBlackMask(payload())
    await svc.emitBlackstar("order.created", { source_order_ref: "o1" }, { eventId: "bs_1" })

    await expect(svc.replayBlackMaskDelivery(rows[0].id)).rejects.toThrow(/not dead/)
    Object.assign(rows[0], { status: "dead", attempt: 8, next_attempt_at: null, response_code: 500, response_body: "x" })
    const fresh = await svc.replayBlackMaskDelivery(rows[0].id)
    expect(fresh).toMatchObject({ status: "pending", attempt: 0, response_code: null, response_body: null })
    expect(rows[0].next_attempt_at).toBeInstanceOf(Date)
    expect(rows[0].event_id).toBe(payload().event_id)

    rows[0].status = "succeeded"
    await expect(svc.replayBlackMaskDelivery(rows[0].id)).rejects.toThrow(/not dead/)
    await expect(svc.replayBlackMaskDelivery(rows[1].id)).rejects.toThrow(/not a Black Mask delivery/)
    await expect(svc.replayBlackMaskDelivery("whd_missing")).rejects.toThrow(/^No delivery/)
  })
})
