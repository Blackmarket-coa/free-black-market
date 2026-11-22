import { createHmac } from "crypto"
import MarketplaceWebhooksService, {
  BLACKSTAR_SUBSCRIPTION_ID,
  isBlackstarEmitConfigured,
} from "../service"

const SECRET = "blackstar_bridge_test_secret_0123"
const API_BASE = "https://blackstar.example"

/**
 * In-memory MarketplaceWebhooksService for the Blackstar outbound channel —
 * same harness as blackout-emit.unit.spec.ts: real class via Object.create,
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

describe("MarketplaceWebhooksService — Blackstar channel", () => {
  const origEnv = { ...process.env }
  beforeEach(() => {
    process.env.BLACKSTAR_WEBHOOK_SECRET = SECRET
    process.env.BLACKSTAR_API_BASE = API_BASE
  })
  afterEach(() => {
    process.env = { ...origEnv }
    jest.restoreAllMocks()
  })

  it("builds the Blackstar contract envelope: fields nested under `payload`", async () => {
    const { svc, rows } = makeService()
    await svc.emitBlackstar(
      "delivery.option.selected",
      { delivery_option: "federated_delivery_network", source_order_ref: "ord_1" },
      { eventId: "blackstar:delivery.option.selected:ord_1:ful_1", correlationId: "ord_1" }
    )

    expect(rows).toHaveLength(1)
    const env = rows[0].payload
    expect(env.event_id).toBe("blackstar:delivery.option.selected:ord_1:ful_1")
    expect(env.event_type).toBe("delivery.option.selected")
    expect(env.correlation_id).toBe("ord_1")
    // Unlike the Blackout channel, fields live under `payload`, not top-level.
    expect(env.payload).toEqual({
      delivery_option: "federated_delivery_network",
      source_order_ref: "ord_1",
    })
    expect(env.delivery_option).toBeUndefined()
    expect(rows[0].subscription_id).toBe(BLACKSTAR_SUBSCRIPTION_ID)
  })

  it("enqueues and signs a parcel cancellation with both identity keys", async () => {
    const { svc, rows } = makeService()
    const payload = { source_order_ref: "ord_1", source_fulfillment_ref: "ful_1" }
    await svc.emitBlackstar("fulfillment.cancelled", payload, { eventId: "cancel_ful_1" })
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ event_type: "fulfillment.cancelled", payload })
    const send = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true, status: 202, text: async () => "{}",
    } as Response)
    expect(await svc.attemptDelivery(rows[0].id)).toBe(true)
    const init = send.mock.calls[0][1]!
    const headers = init.headers as Record<string, string>
    expect(headers["X-FBM-Signature"]).toBe(createHmac("sha256", SECRET)
      .update(`${headers["X-FBM-Timestamp"]}.${init.body}`).digest("hex"))
  })

  it("is idempotent on a stable eventId", async () => {
    const { svc, rows } = makeService()
    const a = await svc.emitBlackstar("order.created", { source_order_ref: "o" }, { eventId: "evt_dup" })
    const b = await svc.emitBlackstar("order.created", { source_order_ref: "o" }, { eventId: "evt_dup" })
    expect(rows).toHaveLength(1)
    expect(a?.id).toBe(b?.id)
  })

  it("refuses event types outside Blackstar's contract", async () => {
    const { svc } = makeService()
    await expect(
      svc.emitBlackstar("shipment.claimed", {}, {})
    ).rejects.toThrow(/Unknown Blackstar event type/)
  })

  it("no-ops when the channel is unconfigured", async () => {
    delete process.env.BLACKSTAR_WEBHOOK_SECRET
    expect(isBlackstarEmitConfigured()).toBe(false)

    const { svc, rows } = makeService()
    const result = await svc.emitBlackstar("order.created", { source_order_ref: "o" }, {})
    expect(result).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it("signs `timestamp.rawBody` and sends the contract headers to the webhook path", async () => {
    const { svc, rows } = makeService()
    await svc.emitBlackstar(
      "order.created",
      { source_order_ref: "ord_9" },
      { eventId: "blackstar:order.created:ord_9", correlationId: "ord_9" }
    )

    const captured: { url?: string; init?: any } = {}
    jest.spyOn(global, "fetch" as any).mockImplementation(async (url: any, init: any) => {
      captured.url = url
      captured.init = init
      return { ok: true, status: 202, text: async () => "{}" } as any
    })

    const ok = await svc.attemptDelivery(rows[0].id)
    expect(ok).toBe(true)
    expect(captured.url).toBe(`${API_BASE}/api/webhooks/freeblackmarket`)

    const headers = captured.init.headers as Record<string, string>
    const ts = headers["X-FBM-Timestamp"]
    expect(ts).toMatch(/^\d+$/)
    expect(headers["X-Correlation-ID"]).toBe("ord_9")

    const expected = createHmac("sha256", SECRET)
      .update(`${ts}.${captured.init.body}`)
      .digest("hex")
    expect(headers["X-FBM-Signature"]).toBe(expected)

    // No credential announced unless BLACKSTAR_EMIT_KEY_ID is configured.
    expect(headers["X-FBM-Key-ID"]).toBeUndefined()

    expect(rows[0].status).toBe("succeeded")
  })

  it("announces the issued key id on X-FBM-Key-ID when configured", async () => {
    process.env.BLACKSTAR_EMIT_KEY_ID = "bsk_issued_by_blackstar_1"

    const { svc, rows } = makeService()
    await svc.emitBlackstar("order.created", { source_order_ref: "ord_k" }, { eventId: "evt_k" })

    const captured: { init?: any } = {}
    jest.spyOn(global, "fetch" as any).mockImplementation(async (_url: any, init: any) => {
      captured.init = init
      return { ok: true, status: 202, text: async () => "{}" } as any
    })

    await svc.attemptDelivery(rows[0].id)
    expect((captured.init.headers as Record<string, string>)["X-FBM-Key-ID"]).toBe(
      "bsk_issued_by_blackstar_1"
    )
  })

  describe("a delivery that carries a secret (node.operator.approved)", () => {
    const NODE_SECRET = "c".repeat(64)
    const emitNodeApproval = (svc: MarketplaceWebhooksService) =>
      svc.emitBlackstar(
        "node.operator.approved",
        { external_ref: "sel_1", seller_id: "sel_1", credential: { key_id: "bsk_abc", secret: NODE_SECRET } },
        { eventId: "evt_node" }
      )
    const answer = (ok: boolean) =>
      jest.spyOn(global, "fetch" as any).mockImplementation(async (_url: any, init: any) => {
        sent.push(JSON.parse(init.body))
        return { ok, status: ok ? 202 : 500, text: async () => (ok ? "{}" : "boom") } as any
      })
    let sent: any[]
    beforeEach(() => {
      sent = []
    })

    it("is never listed with the secret: the operator's view redacts it, whatever the status", async () => {
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)

      const listed = (await svc.listBlackstarDeliveries({})) as any[]
      expect(listed).toHaveLength(1)
      expect(listed[0].payload.payload.credential).toEqual({ key_id: "bsk_abc", secret: "[redacted]" })
      expect(JSON.stringify(listed)).not.toContain(NODE_SECRET)
      // The row itself still holds it: the delivery has not been sent yet.
      expect(rows[0].payload.payload.credential.secret).toBe(NODE_SECRET)
    })

    it("keeps the secret at rest while it may still have to be sent, and a replay answers without it", async () => {
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)
      answer(false)

      expect(await svc.attemptDelivery(rows[0].id)).toBe(false)
      expect(rows[0].status).toBe("failed")
      expect(rows[0].payload.payload.credential.secret).toBe(NODE_SECRET)

      const replayed = (await svc.replayBlackstarDelivery(rows[0].id, { attemptNow: false })) as any
      expect(replayed.delivery.status).toBe("pending")
      expect(replayed.delivery.payload.payload.credential).toEqual({ key_id: "bsk_abc", secret: "[redacted]" })
      expect(rows[0].payload.payload.credential.secret).toBe(NODE_SECRET)
    })

    it("sends Blackstar the real secret, then clears it from the row once the delivery has landed", async () => {
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)
      answer(true)

      expect(await svc.attemptDelivery(rows[0].id)).toBe(true)

      expect(sent).toHaveLength(1)
      expect(sent[0].payload.credential).toEqual({ key_id: "bsk_abc", secret: NODE_SECRET })
      expect(rows[0].status).toBe("succeeded")
      expect(rows[0].payload.payload.credential).toEqual({ key_id: "bsk_abc", secret: "[redacted]" })
      expect(rows[0].payload.event_id).toBe("evt_node")
      expect(JSON.stringify(rows[0])).not.toContain(NODE_SECRET)
    })

    it("never sends a delivered row again: its secret is gone", async () => {
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)
      answer(true)
      await svc.attemptDelivery(rows[0].id)

      expect(await svc.attemptDelivery(rows[0].id)).toBe(true)
      expect(sent).toHaveLength(1)
      await expect(svc.replayBlackstarDelivery(rows[0].id)).rejects.toThrow(/already succeeded/)
    })

    it("does not store the secret back from a response that echoes the request", async () => {
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)
      jest.spyOn(global, "fetch" as any).mockImplementation(async (_url: any, init: any) => {
        return { ok: false, status: 422, text: async () => `rejected: ${init.body}` } as any
      })

      expect(await svc.attemptDelivery(rows[0].id)).toBe(false)
      expect(rows[0].response_body).toContain("rejected:")
      expect(rows[0].response_body).not.toContain(NODE_SECRET)
      expect(JSON.stringify(await svc.listBlackstarDeliveries({}))).not.toContain(NODE_SECRET)
    })

    it("leaves no part of the secret in a stored response cut where the echoed secret falls", async () => {
      // The stored body is cut to 2,000 characters. Cut before scrubbing, a
      // secret straddling the cut kept its first characters.
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)
      // About 1,990 characters of the far end's own text, sized so the echoed
      // secret starts at character 1,990 and runs past the cut at 2,000.
      let echoed = ""
      jest.spyOn(global, "fetch" as any).mockImplementation(async (_url: any, init: any) => {
        const body = String(init.body)
        echoed = `${"x".repeat(1990 - body.indexOf(NODE_SECRET))}${body}`
        return { ok: false, status: 422, text: async () => echoed } as any
      })

      expect(await svc.attemptDelivery(rows[0].id)).toBe(false)
      expect(echoed.indexOf(NODE_SECRET)).toBe(1990)
      const stored = rows[0].response_body as string
      expect(stored).toHaveLength(2000)
      // Not even the secret's first characters, which are what a cut leaves.
      expect(stored).not.toContain(NODE_SECRET.slice(0, 8))
      expect(stored).toBe(echoed.replace(NODE_SECRET, "[redacted]").slice(0, 2000))
    })

    it("a failure written after a concurrent success does not undo it, and a cleared payload is never sent", async () => {
      // Two attempts of one row: the first lands and clears the secret; the
      // second, which read the row before that, fails afterwards.
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)
      answer(true)
      await svc.attemptDelivery(rows[0].id)
      expect(rows[0].status).toBe("succeeded")

      await (svc as any).scheduleRetryOrDie(rows[0].id, 2, 500, "late failure")
      expect(rows[0].status).toBe("succeeded")
      expect(rows[0].response_body).not.toBe("late failure")

      // Had a write put it back anyway, the cleared payload is still not sent.
      rows[0].status = "failed"
      expect(await svc.attemptDelivery(rows[0].id)).toBe(true)
      expect(sent).toHaveLength(1)
      expect(rows[0].status).toBe("succeeded")
      expect(rows[0].next_attempt_at).toBeNull()
    })

    it("a replay of a row that succeeds before its write lands is refused, and the row is left alone", async () => {
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)
      answer(false)
      await svc.attemptDelivery(rows[0].id)
      expect(rows[0].status).toBe("failed")

      // The replay reads "failed"; the drain's success lands before its write.
      const list = (svc as any).listWebhookDeliveries
      let reads = 0
      ;(svc as any).listWebhookDeliveries = async (filters: Record<string, unknown>) => {
        const found = await list(filters)
        reads += 1
        if (reads === 1) {
          const stale = found.map((row: Record<string, unknown>) => ({ ...row }))
          rows[0].status = "succeeded"
          rows[0].payload = { ...rows[0].payload, payload: { ...rows[0].payload.payload, credential: { key_id: "bsk_abc", secret: "[redacted]" } } }
          return stale
        }
        return found
      }

      await expect(svc.replayBlackstarDelivery(rows[0].id, { attemptNow: true })).rejects.toThrow(/already succeeded/)
      expect(rows[0].status).toBe("succeeded")
      expect(sent).toHaveLength(1)
    })

    it("scrubs an echoed secret from a stored response body on the way out, for rows written before it was scrubbed on the way in", async () => {
      const { svc, rows } = makeService()
      await emitNodeApproval(svc)
      rows[0].status = "failed"
      rows[0].response_body = `422 rejected ${NODE_SECRET}`

      const [listed] = (await svc.listBlackstarDeliveries({})) as any[]
      expect(listed.response_body).toBe("422 rejected [redacted]")
      expect(rows[0].response_body).toContain(NODE_SECRET)
    })

    it("leaves a delivery with no secret exactly as it was after it lands", async () => {
      const { svc, rows } = makeService()
      await svc.emitBlackstar("order.created", { source_order_ref: "ord_1" }, { eventId: "evt_order" })
      const before = JSON.stringify(rows[0].payload)
      answer(true)

      await svc.attemptDelivery(rows[0].id)
      expect(JSON.stringify(rows[0].payload)).toBe(before)
    })
  })

  it("schedules a retry on delivery failure instead of dying on attempt one", async () => {
    const { svc, rows } = makeService()
    await svc.emitBlackstar("order.cancelled", { source_order_ref: "ord_x" }, { eventId: "evt_x" })

    jest.spyOn(global, "fetch" as any).mockImplementation(async () => {
      return { ok: false, status: 500, text: async () => "boom" } as any
    })

    const ok = await svc.attemptDelivery(rows[0].id)
    expect(ok).toBe(false)
    expect(rows[0].status).toBe("failed")
    expect(rows[0].attempt).toBe(1)
    expect(rows[0].next_attempt_at).toBeInstanceOf(Date)
  })
})
