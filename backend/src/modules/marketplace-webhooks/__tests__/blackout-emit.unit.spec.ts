import { createHmac } from "crypto"
import MarketplaceWebhooksService, {
  BLACKOUT_SUBSCRIPTION_ID,
  blackoutEmitConfig,
  isBlackoutEmitConfigured,
} from "../service"

const SECRET = "fbm_whsec_test_secret_0123456789"
const API_BASE = "https://api.theblackout.app"

/**
 * In-memory MarketplaceWebhooksService for the Blackout outbound channel.
 * Mirrors the entitlement-service test approach: real class via Object.create,
 * auto-generated CRUD patched onto the instance.
 */
function makeService() {
  const rows: any[] = []
  const svc = Object.create(MarketplaceWebhooksService.prototype) as MarketplaceWebhooksService

  ;(svc as any).listWebhookDeliveries = async (filters: Record<string, any> = {}) =>
    rows.filter((r) =>
      Object.entries(filters).every(([k, v]) => v === undefined || r[k] === v)
    )
  ;(svc as any).createWebhookDeliveries = async (input: any) => {
    const row = { id: `whd_${rows.length + 1}`, ...input }
    rows.push(row)
    return row
  }
  ;(svc as any).updateWebhookDeliveries = async (update: any) => {
    const r = rows.find((x) => x.id === update.id)
    if (r) Object.assign(r, update)
    return r
  }

  return { svc, rows }
}

describe("MarketplaceWebhooksService — Blackout channel (§1)", () => {
  const origEnv = { ...process.env }
  beforeEach(() => {
    process.env.FREEBLACKMARKET_WEBHOOK_SECRET = SECRET
    process.env.BLACKOUT_API_BASE = API_BASE
  })
  afterEach(() => {
    process.env = { ...origEnv }
    jest.restoreAllMocks()
  })

  it("emitBlackout builds a TOP-LEVEL envelope (not the per-seller wrapper)", async () => {
    const { svc, rows } = makeService()
    await svc.emitBlackout(
      "purchase.succeeded",
      { userId: "blk_1", providerListingId: "lst_1", kind: "vault_item" },
      { eventId: "purchase.succeeded:ord_1", metadata: { fbmOrderId: "ord_1", digitalDelivery: true } }
    )

    expect(rows).toHaveLength(1)
    const env = rows[0].payload
    expect(env.eventId).toBe("purchase.succeeded:ord_1")
    expect(env.type).toBe("purchase.succeeded")
    expect(typeof env.occurredAt).toBe("string")
    expect(env.userId).toBe("blk_1") // fields are top-level, not nested under `payload`
    expect(env.metadata).toEqual({ fbmOrderId: "ord_1", digitalDelivery: true })
    expect(rows[0].subscription_id).toBe(BLACKOUT_SUBSCRIPTION_ID)
    expect(rows[0].event_id).toBe("purchase.succeeded:ord_1")
  })

  it("is idempotent on a stable eventId (no second delivery)", async () => {
    const { svc, rows } = makeService()
    const a = await svc.emitBlackout("purchase.succeeded", { userId: "u" }, { eventId: "evt_dup" })
    const b = await svc.emitBlackout("purchase.succeeded", { userId: "u" }, { eventId: "evt_dup" })
    expect(rows).toHaveLength(1)
    expect(a?.id).toBe(b?.id)
  })

  it("signs the EXACT transmitted bytes and sets x-fbm-* headers", async () => {
    const { svc } = makeService()
    const captured: { url?: string; init?: any } = {}
    jest.spyOn(global, "fetch" as any).mockImplementation(async (url: any, init: any) => {
      captured.url = url
      captured.init = init
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) } as any
    })

    const enqueued = await svc.emitBlackout(
      "order.created",
      { vendorId: "v1", orderId: "ord_1", totalCents: 398, currency: "USD" },
      { eventId: "order.created:ord_1" }
    )
    const ok = await svc.attemptDelivery(enqueued!.id)
    expect(ok).toBe(true)

    expect(captured.url).toBe(`${API_BASE}/v1/marketplace/webhooks/freeblackmarket`)
    const sentBody: string = captured.init.body
    const expectedSig = createHmac("sha256", SECRET).update(sentBody).digest("hex")
    expect(captured.init.headers["x-fbm-signature"]).toBe(expectedSig)
    expect(captured.init.headers["x-fbm-signature"]).toMatch(/^[0-9a-f]+$/) // lowercase hex, no prefix
    expect(captured.init.headers["x-fbm-event-id"]).toBe("order.created:ord_1")
    expect(captured.init.headers["content-type"]).toBe("application/json")
    // The signed bytes ARE the envelope we transmit.
    expect(JSON.parse(sentBody).type).toBe("order.created")
  })

  it("no-ops when the emitter is not configured", async () => {
    delete process.env.FREEBLACKMARKET_WEBHOOK_SECRET
    delete process.env.BLACKOUT_API_BASE
    const { svc, rows } = makeService()
    expect(isBlackoutEmitConfigured()).toBe(false)
    expect(blackoutEmitConfig()).toBeNull()
    const r = await svc.emitBlackout("purchase.succeeded", { userId: "u" }, { eventId: "x" })
    expect(r).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it("rejects unknown event types", async () => {
    const { svc } = makeService()
    await expect(
      svc.emitBlackout("not.a.real.event", {}, { eventId: "x" })
    ).rejects.toThrow(/Unknown Blackout event type/)
  })
})
