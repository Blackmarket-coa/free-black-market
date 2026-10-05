import fs from "fs"
import path from "path"
import { GET as listDeliveries } from "../route"
import { POST as replayDelivery } from "../[id]/replay/route"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import { makeHarness } from "../../../../../modules/marketplace-webhooks/__tests__/black-mask-harness"
import { buildBlackMaskPayload } from "../../../../../modules/marketplace-webhooks/black-mask"
import { PHASE0_FEATURE_FLAGS } from "../../../../../shared/feature-flags"
import { requireFeatureFlagMiddleware } from "../../../../../shared/runtime-module-gates"

/**
 * GET /admin/black-mask/deliveries and POST
 * /admin/black-mask/deliveries/:id/replay against the REAL
 * MarketplaceWebhooksService (black-mask-harness), resolved on the imported
 * MARKETPLACE_WEBHOOKS_MODULE (the scope throws on anything else), and the
 * REAL requireFeatureFlagMiddleware.
 */

const FLAG = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1
const ENV = [
  FLAG,
  "BLACK_MASK_PROVISIONING_URL",
  "BLACK_MASK_WEBHOOK_SECRET",
  "BLACK_MASK_WEBHOOK_KEY_ID",
  "BLACK_MASK_SELLER_ID",
  "BLACKSTAR_WEBHOOK_SECRET",
  "BLACKSTAR_API_BASE",
] as const

afterEach(() => {
  for (const k of ENV) delete process.env[k]
})

function enable() {
  process.env[FLAG] = "true"
  process.env.BLACK_MASK_PROVISIONING_URL = "https://bm.example/hooks/fbm"
  process.env.BLACK_MASK_WEBHOOK_SECRET = "s"
  process.env.BLACK_MASK_WEBHOOK_KEY_ID = "k1"
  process.env.BLACK_MASK_SELLER_ID = "sel_bmc"
}

type TestRes = {
  statusCode: number
  body: Record<string, unknown>
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}
const createRes = (): TestRes => {
  const res = { statusCode: 200, body: {} } as TestRes
  res.status = (c) => ((res.statusCode = c), res)
  res.json = (p) => ((res.body = p as Record<string, unknown>), res)
  return res
}

type Handler = (req: never, res: never) => Promise<unknown>

async function world() {
  const harness = makeHarness()
  const resolved: string[] = []
  const scope = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === MARKETPLACE_WEBHOOKS_MODULE) return harness.svc as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { ...harness, scope, resolved }
}

const payload = (id: string) =>
  buildBlackMaskPayload({
    event: "placed",
    subject: { type: "order", id },
    sequence: 1767225600000,
    customerId: "cus_1",
    plan: "vault_monthly",
    seats: 1,
    sellerId: "sel_bmc",
  })

async function call(handler: Handler, scope: unknown, req: Record<string, unknown>) {
  const res = createRes()
  await handler({ ...req, scope } as never, res as never)
  return res
}

/** The route as registered: the real flag middleware, then the handler. */
async function throughGate(handler: Handler, scope: unknown, req: Record<string, unknown>) {
  const res = createRes()
  const request = { ...req, scope } as never
  let reached = false
  await requireFeatureFlagMiddleware("BLACK_MASK_PROVISIONING_V1")(request, res as never, async () => {
    reached = true
    await handler(request, res as never)
  })
  return { res, reached }
}

describe("flag off", () => {
  it("both routes are 404 through the real middleware, and the handler is never reached", async () => {
    const w = await world()
    for (const [handler, req] of [
      [listDeliveries, { query: {} }],
      [replayDelivery, { params: { id: "whd_1" }, body: {} }],
    ] as Array<[Handler, Record<string, unknown>]>) {
      const { res, reached } = await throughGate(handler, w.scope, req)
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled" })
      expect(reached).toBe(false)
    }
    expect(w.resolved).toEqual([])
  })

  it("the handlers repeat the check themselves (a matcher typo cannot open them)", async () => {
    const w = await world()
    const list = await call(listDeliveries, w.scope, { query: {} })
    const replay = await call(replayDelivery, w.scope, { params: { id: "whd_1" }, body: {} })
    for (const res of [list, replay]) {
      expect(res.statusCode).toBe(404)
      expect(res.body).toMatchObject({ type: "feature_disabled" })
    }
    expect(w.resolved).toEqual([])
  })

  it("the matcher exists with admin auth and the flag gate, and its glob covers both paths", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../../middlewares.ts"), "utf8")
    const blocks = source.split(/\n\s*\{\s*\n/)
    const block = blocks.find((b) => b.includes('matcher: "/admin/black-mask*"'))
    expect(block).toBeDefined()
    expect(block).toContain('authenticate("user", ["bearer", "session"])')
    expect(block).toContain('requireFeatureFlagMiddleware("BLACK_MASK_PROVISIONING_V1")')

    const pathToRegexp = require(require.resolve("path-to-regexp", { paths: [require.resolve("express")] })) as (
      p: string,
      keys: unknown[],
      opts: Record<string, unknown>
    ) => RegExp
    expect(pathToRegexp("/admin/black-mask*", [], {}).test("/admin/black-mask/deliveries")).toBe(true)
    expect(pathToRegexp("/admin/black-mask*", [], {}).test("/admin/black-mask/deliveries/whd_1/replay")).toBe(true)
    expect(pathToRegexp("/admin/black-mask*", [], {}).test("/admin/blackstar/deliveries")).toBe(false)
  })
})

describe("flag on", () => {
  it("GET lists dead+failed by default, filters by status, and rejects an unknown status", async () => {
    enable()
    const w = await world()
    await w.svc.emitBlackMask(payload("order_a"))
    await w.svc.emitBlackMask(payload("order_b"))
    await w.svc.emitBlackMask(payload("order_c"))
    w.rows[0].status = "dead"
    w.rows[1].status = "failed"

    const byDefault = (await throughGate(listDeliveries, w.scope, { query: {} })).res
    expect(byDefault.statusCode).toBe(200)
    expect(byDefault.body.filter).toBe("dead,failed")
    expect((byDefault.body.deliveries as Array<{ id: string }>).map((d) => d.id).sort()).toEqual(["whd_1", "whd_2"])

    const pending = await call(listDeliveries, w.scope, { query: { status: "pending" } })
    expect((pending.body.deliveries as Array<{ id: string }>).map((d) => d.id)).toEqual(["whd_3"])
    expect(pending.body.count).toBe(1)

    const bad = await call(listDeliveries, w.scope, { query: { status: "exploded" } })
    expect(bad.statusCode).toBe(400)

    expect(new Set(w.resolved)).toEqual(new Set([MARKETPLACE_WEBHOOKS_MODULE]))
  })

  it("GET only shows Black Mask rows", async () => {
    enable()
    process.env.BLACKSTAR_WEBHOOK_SECRET = "bs"
    process.env.BLACKSTAR_API_BASE = "https://blackstar.example"
    const w = await world()
    await w.svc.emitBlackstar("order.created", { source_order_ref: "o" }, { eventId: "bs_1" })
    w.rows[0].status = "dead"
    const res = await call(listDeliveries, w.scope, { query: {} })
    expect(res.body.count).toBe(0)
  })

  it("POST replay: dead -> pending with attempt 0; 409 when not dead; 404 when missing", async () => {
    enable()
    const w = await world()
    await w.svc.emitBlackMask(payload("order_a"))

    const notDead = await call(replayDelivery, w.scope, { params: { id: "whd_1" }, body: {} })
    expect(notDead.statusCode).toBe(409)

    Object.assign(w.rows[0], { status: "dead", attempt: 8, next_attempt_at: null })
    const { res, reached } = await throughGate(replayDelivery, w.scope, { params: { id: "whd_1" }, body: {} })
    expect(reached).toBe(true)
    expect(res.statusCode).toBe(200)
    expect(res.body.queued).toBe(true)
    expect(res.body.delivery).toMatchObject({ id: "whd_1", status: "pending", attempt: 0 })
    expect(w.rows[0]).toMatchObject({ status: "pending", attempt: 0 })

    const missing = await call(replayDelivery, w.scope, { params: { id: "whd_nope" }, body: {} })
    expect(missing.statusCode).toBe(404)
  })
})
