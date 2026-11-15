import { POST } from "../route"
import { SUPPLIER_FORWARDING_MODULE } from "../../../../../modules/supplier-forwarding"
import { ManualFulfillmentStatus } from "../../../../../modules/supplier-forwarding/models"
import {
  SUPPLIER_WEBHOOK_SECRET_ENV,
  SUPPLIER_WEBHOOK_SIGNATURE_HEADER,
  signSupplierWebhookBody,
  supplierWebhookKey,
} from "../../../../../modules/supplier-forwarding/webhook-auth"
import { makeInMemorySupplierForwarding } from "../../../../../modules/supplier-forwarding/__tests__/in-memory-supplier-forwarding"

/**
 * `POST /webhooks/suppliers/status` was public and wrote a
 * manual_fulfillment_update for whatever order_id, supplier_id and status the
 * body named: no secret, no signature, no check that the order was forwarded
 * to that supplier, no state machine. Anyone on the internet could mark any
 * order shipped or delivered.
 *
 * Pinned here against the REAL handler (the service is an in-memory stand-in
 * for the generated CRUD it calls, resolved on the IMPORTED
 * `SUPPLIER_FORWARDING_MODULE`; the scope throws on any other key):
 *   - fails closed: 503 with the secret unset or under 32 characters, and the
 *     module is never resolved;
 *   - 401 for unsigned, forged, tampered and impersonating requests, signed
 *     with anything but the key derived for the body's supplier_id, and
 *     nothing is read or written;
 *   - 403 (`forbidden()`) when the signer's order was never forwarded to it,
 *     the order does not exist, or the supplier's profile is inactive/absent;
 *   - 409 for a transition the manual-fulfillment state machine does not
 *     allow; 200 `duplicate` for a re-delivery of the current status;
 *   - 200 and exactly one row, `source: "supplier_webhook"`, for a correctly
 *     signed valid transition.
 */

const SECRET = "supplier-webhook-operator-secret-0123456789abcdef"
const ACME = "sup_acme"
const BOLT = "sup_bolt"
const ORDER_ACME = "order_01ACME"
const ORDER_BOLT = "order_01BOLT"

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

function world() {
  const store = makeInMemorySupplierForwarding({
    profiles: [
      { supplier_id: ACME, display_name: "Acme", contact_method: "manual", is_active: true },
      { supplier_id: BOLT, display_name: "Bolt", contact_method: "api", is_active: true },
      { supplier_id: "sup_gone", display_name: "Gone", contact_method: "manual", is_active: false },
    ],
    attempts: [
      { order_id: ORDER_ACME, supplier_id: ACME, status: "pending" },
      { order_id: ORDER_BOLT, supplier_id: BOLT, status: "forwarded" },
      { order_id: "order_01GONE", supplier_id: "sup_gone", status: "pending" },
    ],
  })
  const resolved: string[] = []
  const scope = {
    resolve(key: string) {
      resolved.push(key)
      if (key === SUPPLIER_FORWARDING_MODULE) return store.service
      throw new Error(`unexpected container key in spec: ${key}`)
    },
  }
  return { ...store, scope, resolved }
}

type World = ReturnType<typeof world>

/** A request whose raw body is exactly `raw`, signed (or not) as given. */
function request(w: World, raw: string, signature?: string) {
  return {
    scope: w.scope,
    headers: signature === undefined ? {} : { [SUPPLIER_WEBHOOK_SIGNATURE_HEADER]: signature },
    rawBody: Buffer.from(raw, "utf8"),
    body: JSON.parse(raw) as unknown,
  }
}

const keyFor = (supplierId: string) => supplierWebhookKey(SECRET, supplierId)
const signedBy = (supplierId: string, raw: string) => signSupplierWebhookBody(keyFor(supplierId), raw)

async function send(w: World, payload: Record<string, unknown>, signer: string | null = String(payload.supplier_id)) {
  const raw = JSON.stringify(payload)
  const res = createRes()
  await POST(request(w, raw, signer === null ? undefined : signedBy(signer, raw)) as never, res as never)
  return res
}

const status = (order_id: string, supplier_id: string, s: ManualFulfillmentStatus, extra: Record<string, unknown> = {}) => ({
  order_id,
  supplier_id,
  status: s,
  ...extra,
})

const ORIGINAL_SECRET = process.env[SUPPLIER_WEBHOOK_SECRET_ENV]
beforeEach(() => {
  process.env[SUPPLIER_WEBHOOK_SECRET_ENV] = SECRET
})
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env[SUPPLIER_WEBHOOK_SECRET_ENV]
  else process.env[SUPPLIER_WEBHOOK_SECRET_ENV] = ORIGINAL_SECRET
})

describe("fails closed without a usable operator secret", () => {
  it("503 with SUPPLIER_WEBHOOK_SECRET unset; the module is never resolved", async () => {
    delete process.env[SUPPLIER_WEBHOOK_SECRET_ENV]
    const w = world()
    const res = await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))
    expect(res.statusCode).toBe(503)
    expect(w.resolved).toEqual([])
    expect(w.tables.updates).toHaveLength(0)
  })

  it("503 with a secret shorter than 32 characters, even for a request signed under it", async () => {
    const short = "too-short-secret"
    process.env[SUPPLIER_WEBHOOK_SECRET_ENV] = short
    const w = world()
    const raw = JSON.stringify(status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))
    const sig = signSupplierWebhookBody(supplierWebhookKey(short, ACME), raw)
    const res = createRes()
    await POST(request(w, raw, sig) as never, res as never)
    expect(res.statusCode).toBe(503)
    expect(w.resolved).toEqual([])
    expect(w.tables.updates).toHaveLength(0)
  })
})

describe("refuses anything not signed with the supplier's own key", () => {
  it("400 when the raw body did not survive parsing", async () => {
    const w = world()
    const raw = JSON.stringify(status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))
    const res = createRes()
    await POST({ ...request(w, raw, signedBy(ACME, raw)), rawBody: undefined } as never, res as never)
    expect(res.statusCode).toBe(400)
    expect(w.tables.updates).toHaveLength(0)
  })

  it("401 for an unsigned request (the old behaviour accepted it)", async () => {
    const w = world()
    const res = await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED), null)
    expect(res.statusCode).toBe(401)
    expect(w.resolved).toEqual([])
    expect(w.tables.updates).toHaveLength(0)
  })

  it.each([
    ["a made-up key", (raw: string) => signSupplierWebhookBody("not-the-key", raw)],
    ["the operator secret itself instead of the derived key", (raw: string) => signSupplierWebhookBody(SECRET, raw)],
    ["garbage", () => "deadbeef"],
    ["an empty header", () => ""],
  ])("401 for a signature made with %s", async (_label, sign) => {
    const w = world()
    const raw = JSON.stringify(status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))
    const res = createRes()
    await POST(request(w, raw, sign(raw)) as never, res as never)
    expect(res.statusCode).toBe(401)
    expect(w.resolved).toEqual([])
    expect(w.tables.updates).toHaveLength(0)
  })

  it("401 when the body is altered after signing", async () => {
    const w = world()
    const signedRaw = JSON.stringify(status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))
    const sentRaw = JSON.stringify(status(ORDER_ACME, ACME, ManualFulfillmentStatus.CANCELED))
    const res = createRes()
    await POST(request(w, sentRaw, signedBy(ACME, signedRaw)) as never, res as never)
    expect(res.statusCode).toBe(401)
    expect(w.tables.updates).toHaveLength(0)
  })

  it("401 when one supplier signs, with its own valid key, a body claiming to be another", async () => {
    const w = world()
    // Bolt holds a real key, but only Bolt's: it cannot speak for Acme.
    const res = await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.CANCELED), BOLT)
    expect(res.statusCode).toBe(401)
    expect(w.resolved).toEqual([])
    expect(w.tables.updates).toHaveLength(0)
  })

  it("401 when the body names no supplier", async () => {
    const w = world()
    const raw = JSON.stringify({ order_id: ORDER_ACME, status: ManualFulfillmentStatus.ACKNOWLEDGED })
    const res = createRes()
    await POST(request(w, raw, signedBy("", raw)) as never, res as never)
    expect(res.statusCode).toBe(401)
    expect(w.tables.updates).toHaveLength(0)
  })

  it("400 for a correctly signed body that fails the schema", async () => {
    const w = world()
    const res = await send(w, { order_id: ORDER_ACME, supplier_id: ACME, status: "lost_at_sea" })
    expect(res.statusCode).toBe(400)
    expect(w.tables.updates).toHaveLength(0)
  })
})

describe("binds the update to an order forwarded to the signing supplier", () => {
  it("403 when a correctly signed supplier reports on an order forwarded to someone else", async () => {
    const w = world()
    const res = await send(w, status(ORDER_ACME, BOLT, ManualFulfillmentStatus.SHIPPED))
    expect(res.statusCode).toBe(403)
    expect(w.tables.updates).toHaveLength(0)
  })

  it("403, the same answer, for an order id that does not exist", async () => {
    const w = world()
    const notYours = await send(w, status(ORDER_ACME, BOLT, ManualFulfillmentStatus.ACKNOWLEDGED))
    const noSuch = await send(w, status("order_01NOPE", BOLT, ManualFulfillmentStatus.ACKNOWLEDGED))
    expect(noSuch.statusCode).toBe(403)
    expect(noSuch.body).toEqual(notYours.body)
    expect(w.tables.updates).toHaveLength(0)
  })

  it("403 for a deactivated supplier, even on its own forwarded order", async () => {
    const w = world()
    const res = await send(w, status("order_01GONE", "sup_gone", ManualFulfillmentStatus.ACKNOWLEDGED))
    expect(res.statusCode).toBe(403)
    expect(w.tables.updates).toHaveLength(0)
  })

  it("403 for a supplier id with a validly derived key but no profile", async () => {
    const w = world()
    const res = await send(w, status(ORDER_ACME, "sup_unregistered", ManualFulfillmentStatus.ACKNOWLEDGED))
    expect(res.statusCode).toBe(403)
    expect(w.tables.updates).toHaveLength(0)
  })
})

describe("follows the manual-fulfillment state machine", () => {
  it("409 for a skipped step (pending -> shipped); nothing written", async () => {
    const w = world()
    const res = await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.SHIPPED))
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: "invalid_transition", current_status: ManualFulfillmentStatus.PENDING })
    expect(w.tables.updates).toHaveLength(0)
  })

  it("409 for moving a delivered order to canceled", async () => {
    const w = world()
    for (const s of [
      ManualFulfillmentStatus.ACKNOWLEDGED,
      ManualFulfillmentStatus.IN_PROGRESS,
      ManualFulfillmentStatus.SHIPPED,
      ManualFulfillmentStatus.DELIVERED,
    ]) {
      expect((await send(w, status(ORDER_ACME, ACME, s))).statusCode).toBe(200)
    }
    const res = await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.CANCELED))
    expect(res.statusCode).toBe(409)
    expect(w.tables.updates.map((u) => u.status)).toEqual([
      ManualFulfillmentStatus.ACKNOWLEDGED,
      ManualFulfillmentStatus.IN_PROGRESS,
      ManualFulfillmentStatus.SHIPPED,
      ManualFulfillmentStatus.DELIVERED,
    ])
  })

  it("a replayed delivery of the current status is acknowledged and writes nothing", async () => {
    const w = world()
    expect((await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))).statusCode).toBe(200)
    const replay = await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))
    expect(replay.statusCode).toBe(200)
    expect(replay.body).toMatchObject({ received: true, duplicate: true })
    expect(w.tables.updates).toHaveLength(1)
  })

  it("an old message replayed after the order moved on is refused", async () => {
    const w = world()
    await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))
    await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.IN_PROGRESS))
    const replay = await send(w, status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED))
    expect(replay.statusCode).toBe(409)
    expect(w.tables.updates).toHaveLength(2)
  })
})

describe("accepts a correctly signed, valid transition", () => {
  it("200 and one manual_fulfillment_update with source supplier_webhook", async () => {
    const w = world()
    const res = await send(
      w,
      status(ORDER_ACME, ACME, ManualFulfillmentStatus.ACKNOWLEDGED, {
        notes: "Picked up by the warehouse",
        metadata: { ref: "ACME-778" },
      })
    )
    expect(res.statusCode).toBe(200)
    expect(res.body.received).toBe(true)
    expect(w.tables.updates).toHaveLength(1)
    expect(w.tables.updates[0]).toMatchObject({
      order_id: ORDER_ACME,
      supplier_id: ACME,
      status: ManualFulfillmentStatus.ACKNOWLEDGED,
      notes: "Picked up by the warehouse",
      source: "supplier_webhook",
      metadata: { ref: "ACME-778" },
    })
    expect(w.resolved).toEqual([SUPPLIER_FORWARDING_MODULE])
  })

  it("accepts the signature in upper-case hex", async () => {
    const w = world()
    const raw = JSON.stringify(status(ORDER_BOLT, BOLT, ManualFulfillmentStatus.CANCELED))
    const res = createRes()
    await POST(request(w, raw, signedBy(BOLT, raw).toUpperCase()) as never, res as never)
    expect(res.statusCode).toBe(200)
    expect(w.tables.updates).toHaveLength(1)
  })
})
