import { createHmac } from "crypto"
import {
  DEFAULT_TOLERANCE_SECONDS,
  STATUS_FOR_BLACKSTAR_EVENT,
  verifyBlackstarSignature,
} from "../verify-blackstar-signature"

const SECRET = "blackstar_outbound_test_secret_456"
const NOW = 1_800_000_000

function sign(rawBody: string, ts: number, secret = SECRET) {
  return createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")
}

describe("verifyBlackstarSignature", () => {
  const body = JSON.stringify({ event_type: "shipment.claimed", payload: { source_order_ref: "o1" } })

  it("accepts a fresh, correctly signed request", () => {
    const v = verifyBlackstarSignature({
      rawBody: body,
      timestampHeader: String(NOW),
      signatureHeader: sign(body, NOW),
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(v).toEqual({ ok: true })
  })

  it("returns 503 when the secret is unconfigured — never authenticates against an empty key", () => {
    const v = verifyBlackstarSignature({
      rawBody: body,
      timestampHeader: String(NOW),
      signatureHeader: sign(body, NOW, ""),
      secret: undefined,
      nowSeconds: NOW,
    })
    expect(v).toEqual({ ok: false, status: 503, message: expect.stringContaining("not configured") })
  })

  it("rejects a wrong-secret signature with 401", () => {
    const v = verifyBlackstarSignature({
      rawBody: body,
      timestampHeader: String(NOW),
      signatureHeader: sign(body, NOW, "some-other-secret"),
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(v).toEqual({ ok: false, status: 401, message: "Invalid signature." })
  })

  it("rejects a correctly signed but stale request as a replay", () => {
    const staleTs = NOW - DEFAULT_TOLERANCE_SECONDS - 1
    const v = verifyBlackstarSignature({
      rawBody: body,
      timestampHeader: String(staleTs),
      signatureHeader: sign(body, staleTs),
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(v).toEqual({ ok: false, status: 401, message: "Stale signature." })
  })

  it("rejects a missing or malformed timestamp", () => {
    for (const ts of [undefined, "", "12a3", "-5", "1.5"]) {
      const v = verifyBlackstarSignature({
        rawBody: body,
        timestampHeader: ts as any,
        signatureHeader: sign(body, NOW),
        secret: SECRET,
        nowSeconds: NOW,
      })
      expect(v).toEqual({ ok: false, status: 401, message: "Missing or malformed timestamp." })
    }
  })

  it("rejects a signature whose timestamp does not match the header (moved-timestamp splice)", () => {
    const v = verifyBlackstarSignature({
      rawBody: body,
      timestampHeader: String(NOW),
      signatureHeader: sign(body, NOW - 10),
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(v).toEqual({ ok: false, status: 401, message: "Invalid signature." })
  })

  it("survives length-mismatched signature headers without throwing", () => {
    const v = verifyBlackstarSignature({
      rawBody: body,
      timestampHeader: String(NOW),
      signatureHeader: "deadbeef",
      secret: SECRET,
      nowSeconds: NOW,
    })
    expect(v).toEqual({ ok: false, status: 401, message: "Invalid signature." })
  })

  it("respects a custom tolerance window", () => {
    const ts = NOW - 30
    const tight = verifyBlackstarSignature({
      rawBody: body,
      timestampHeader: String(ts),
      signatureHeader: sign(body, ts),
      secret: SECRET,
      nowSeconds: NOW,
      toleranceSeconds: 10,
    })
    expect(tight).toEqual({ ok: false, status: 401, message: "Stale signature." })
  })
})

describe("STATUS_FOR_BLACKSTAR_EVENT", () => {
  it("maps exactly the five contract lifecycle events", () => {
    expect(Object.keys(STATUS_FOR_BLACKSTAR_EVENT).sort()).toEqual([
      "shipment.cancelled",
      "shipment.claimed",
      "shipment.delivered",
      "shipment.disputed",
      "shipment.in_transit",
    ])
    expect(STATUS_FOR_BLACKSTAR_EVENT["shipment.in_transit"]).toBe("in_transit")
  })
})
