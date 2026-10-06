import { createHmac } from "crypto"
import {
  BLACK_MASK_EVENTS,
  BLACK_MASK_MAX_ATTEMPTS,
  BLACK_MASK_RETRY_LADDER_MINUTES,
  blackMaskEventId,
  blackMaskPlanCode,
  blackMaskProvisioningConfig,
  blackMaskRetryDelayMinutes,
  buildBlackMaskPayload,
  buildBlackMaskWireBody,
  deliverableEmail,
  isBlackMaskEvent,
  isBlackMaskStoredPayload,
  isBlackMaskVaultLine,
  sequenceFrom,
  signBlackMaskBody,
  verifyBlackMaskSignature,
} from "../black-mask"

/**
 * The pure half of the Black Mask provisioning channel (F3): marker, key,
 * payload, signature, email rule, ladder, config. The fixed signature vectors
 * here are the same ones docs/BLACK_MASK_PROVISIONING_CONTRACT.md prints, and
 * were cross-checked with `openssl dgst -sha256 -hmac`.
 */

const SELLER = "sel_bmc"
const ENV_KEYS = [
  "BLACK_MASK_PROVISIONING_URL",
  "BLACK_MASK_WEBHOOK_SECRET",
  "BLACK_MASK_WEBHOOK_KEY_ID",
  "BLACK_MASK_SELLER_ID",
] as const
const savedNodeEnv = process.env.NODE_ENV

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = savedNodeEnv
})

describe("vault marker", () => {
  it("is true only for the configured seller's product carrying a plan code", () => {
    expect(
      isBlackMaskVaultLine({ productSellerId: SELLER, productMetadata: { black_mask_plan: "vault_monthly" } }, SELLER)
    ).toBe(true)
  })

  it("refuses a plan code on another seller's product", () => {
    expect(
      isBlackMaskVaultLine({ productSellerId: "sel_other", productMetadata: { black_mask_plan: "vault_monthly" } }, SELLER)
    ).toBe(false)
  })

  it("refuses a BMC product with no (or a malformed) plan code", () => {
    expect(isBlackMaskVaultLine({ productSellerId: SELLER, productMetadata: {} }, SELLER)).toBe(false)
    expect(isBlackMaskVaultLine({ productSellerId: SELLER, productMetadata: null }, SELLER)).toBe(false)
    expect(isBlackMaskVaultLine({ productSellerId: SELLER, productMetadata: { black_mask_plan: 7 } }, SELLER)).toBe(false)
    expect(isBlackMaskVaultLine({ productSellerId: SELLER, productMetadata: { black_mask_plan: "  " } }, SELLER)).toBe(false)
    expect(
      isBlackMaskVaultLine({ productSellerId: SELLER, productMetadata: { black_mask_plan: "<script>" } }, SELLER)
    ).toBe(false)
  })

  it("refuses a product with no seller link, and an empty configured seller", () => {
    expect(isBlackMaskVaultLine({ productSellerId: null, productMetadata: { black_mask_plan: "p" } }, SELLER)).toBe(false)
    expect(isBlackMaskVaultLine({ productSellerId: "", productMetadata: { black_mask_plan: "p" } }, "")).toBe(false)
  })

  it("trims the plan code", () => {
    expect(blackMaskPlanCode({ black_mask_plan: " vault_annual " })).toBe("vault_annual")
  })
})

describe("event set", () => {
  it("is exactly the §2 table, `expired` included", () => {
    expect([...BLACK_MASK_EVENTS]).toEqual([
      "placed",
      "renewed",
      "cancelled",
      "payment_failed",
      "grace_started",
      "read_only",
      "expired",
    ])
    expect(isBlackMaskEvent("expired")).toBe(true)
    expect(isBlackMaskEvent("expire")).toBe(false)
    expect(isBlackMaskEvent("lapsed")).toBe(false)
  })

  it("an `expired` subscription payload is a stored payload keyed like the others, with no email", () => {
    const p = buildBlackMaskPayload({
      event: "expired",
      subject: { type: "subscription", id: "sub_1" },
      sequence: 1772323200000,
      customerId: "cus_1",
      plan: "vault_monthly",
      seats: 1,
      sellerId: SELLER,
      periodEnd: "2026-03-01T00:00:00.000Z",
    })
    expect(p.event_id).toBe("bm:v1:subscription:sub_1:expired:1772323200000")
    expect(p.occurred_at).toBe("2026-03-01T00:00:00.000Z")
    expect(isBlackMaskStoredPayload(p)).toBe(true)
    expect(isBlackMaskStoredPayload({ ...p, event: "lapsed" })).toBe(false)
    expect(buildBlackMaskWireBody(p, "a@b.example")).not.toMatch(/email/i)
  })
})

describe("event id and sequence", () => {
  it("keys on (subject, event, sequence)", () => {
    expect(blackMaskEventId({ type: "subscription", id: "sub_1" }, "renewed", 1767225600000)).toBe(
      "bm:v1:subscription:sub_1:renewed:1767225600000"
    )
  })

  it("derives the sequence from a record timestamp, the same value every time", () => {
    expect(sequenceFrom("2026-01-01T00:00:00.000Z")).toBe(1767225600000)
    expect(sequenceFrom(new Date("2026-01-01T00:00:00.000Z"))).toBe(1767225600000)
    expect(sequenceFrom(null)).toBeNull()
    expect(sequenceFrom("not a date")).toBeNull()
  })
})

describe("payload", () => {
  it("carries exactly the minimised fields, with occurred_at from the sequence", () => {
    const p = buildBlackMaskPayload({
      event: "renewed",
      subject: { type: "subscription", id: "sub_1" },
      sequence: 1767225600000,
      customerId: "cus_1",
      plan: "vault_monthly",
      seats: 3,
      sellerId: SELLER,
      periodEnd: "2026-02-01T00:00:00.000Z",
      orderId: "order_r2",
    })
    expect(p).toEqual({
      event: "renewed",
      event_id: "bm:v1:subscription:sub_1:renewed:1767225600000",
      sequence: 1767225600000,
      occurred_at: "2026-01-01T00:00:00.000Z",
      subject: { type: "subscription", id: "sub_1" },
      customer_id: "cus_1",
      plan: "vault_monthly",
      seats: 3,
      seller_id: SELLER,
      period_end: "2026-02-01T00:00:00.000Z",
      order_id: "order_r2",
    })
    expect(JSON.stringify(p)).not.toMatch(/email/i)
  })

  it("defaults bad seat counts to 1 and omits absent optional fields", () => {
    const p = buildBlackMaskPayload({
      event: "placed",
      subject: { type: "order", id: "order_1" },
      sequence: 1,
      customerId: null,
      plan: "p",
      seats: 0,
      sellerId: SELLER,
    })
    expect(p.seats).toBe(1)
    expect("period_end" in p).toBe(false)
    expect("order_id" in p).toBe(false)
    expect("subscription_id" in p).toBe(false)
  })
})

describe("wire body and email", () => {
  const placed = buildBlackMaskPayload({
    event: "placed",
    subject: { type: "order", id: "order_1" },
    sequence: 1767225600000,
    customerId: "cus_1",
    plan: "vault_monthly",
    seats: 1,
    sellerId: SELLER,
  })

  it("adds customer_email to `placed` only", () => {
    expect(JSON.parse(buildBlackMaskWireBody(placed, "a@b.example")).customer_email).toBe("a@b.example")
    const cancelled = { ...placed, event: "cancelled" as const }
    expect(JSON.parse(buildBlackMaskWireBody(cancelled, "a@b.example")).customer_email).toBeUndefined()
    expect(JSON.parse(buildBlackMaskWireBody(placed, null)).customer_email).toBeUndefined()
  })

  it("never lets a placeholder address leave FBM", () => {
    expect(deliverableEmail({ email: "member@example.org" })).toBe("member@example.org")
    expect(deliverableEmail({ email: "blackout+abc@users.blackout.invalid", metadata: { synthetic_email: true } })).toBeNull()
    expect(deliverableEmail({ email: "blackout+abc@users.blackout.invalid" })).toBeNull()
    expect(deliverableEmail({ email: "deleted-cus_1@deleted.invalid" })).toBeNull()
    expect(deliverableEmail({ email: "real@example.org", metadata: { synthetic_email: true } })).toBeNull()
    expect(deliverableEmail({ email: "" })).toBeNull()
    expect(deliverableEmail({ email: null })).toBeNull()
    expect(deliverableEmail(null)).toBeNull()
  })
})

describe("signature", () => {
  it("matches the fixed vector (HMAC-SHA256 hex over `{timestamp}.{raw_body}`)", () => {
    expect(signBlackMaskBody("bm_test_secret", "1700000000", '{"event":"placed"}')).toBe(
      "0a050026aea76ed365b98455a6659cb3f1c4ea203e102d0a413bd0f30b5eb718"
    )
  })

  it("matches the contract doc's worked example", () => {
    const body =
      '{"event":"placed","event_id":"bm:v1:order:order_01J:placed:1767225600000","sequence":1767225600000}'
    expect(signBlackMaskBody("bm_whsec_example_only", "1767225660", body)).toBe(
      "5ad5686aa13fe3fe09b1f6c45a9d64581b6986c30324d448a318109804582b4a"
    )
    expect(signBlackMaskBody("bm_whsec_example_only", "1767225660", body)).toBe(
      createHmac("sha256", "bm_whsec_example_only").update(`1767225660.${body}`).digest("hex")
    )
  })

  it("the reference verifier accepts within +/-300s and rejects outside it, a changed body, a wrong secret", () => {
    const body = '{"event":"placed"}'
    const sig = signBlackMaskBody("s", "1700000000", body)
    const base = { secret: "s", timestamp: "1700000000", rawBody: body, signature: sig }
    expect(verifyBlackMaskSignature({ ...base, nowSeconds: 1700000000 })).toBe(true)
    expect(verifyBlackMaskSignature({ ...base, nowSeconds: 1700000300 })).toBe(true)
    expect(verifyBlackMaskSignature({ ...base, nowSeconds: 1699999700 })).toBe(true)
    expect(verifyBlackMaskSignature({ ...base, nowSeconds: 1700000301 })).toBe(false)
    expect(verifyBlackMaskSignature({ ...base, nowSeconds: 1699999699 })).toBe(false)
    expect(verifyBlackMaskSignature({ ...base, rawBody: '{"event":"cancelled"}', nowSeconds: 1700000000 })).toBe(false)
    expect(verifyBlackMaskSignature({ ...base, secret: "t", nowSeconds: 1700000000 })).toBe(false)
    expect(verifyBlackMaskSignature({ ...base, signature: "zz", nowSeconds: 1700000000 })).toBe(false)
  })
})

describe("retry ladder", () => {
  it("is 8 attempts spanning about 45 hours, then dead", () => {
    expect(BLACK_MASK_MAX_ATTEMPTS).toBe(8)
    const total = BLACK_MASK_RETRY_LADDER_MINUTES.reduce((a, b) => a + b, 0)
    expect(total).toBe(2676)
    expect(total / 60).toBeGreaterThan(44)
    expect(total / 60).toBeLessThan(46)
    expect([1, 2, 3, 4, 5, 6, 7].map(blackMaskRetryDelayMinutes)).toEqual([1, 5, 30, 120, 360, 720, 1440])
    expect(blackMaskRetryDelayMinutes(8)).toBeNull()
  })
})

describe("config", () => {
  const setAll = () => {
    process.env.BLACK_MASK_PROVISIONING_URL = "https://bm.example/hooks/fbm"
    process.env.BLACK_MASK_WEBHOOK_SECRET = "sec"
    process.env.BLACK_MASK_WEBHOOK_KEY_ID = "k1"
    process.env.BLACK_MASK_SELLER_ID = SELLER
  }

  it("is complete only with all four values", () => {
    expect(blackMaskProvisioningConfig()).toBeNull()
    setAll()
    expect(blackMaskProvisioningConfig()).toEqual({
      url: "https://bm.example/hooks/fbm",
      secret: "sec",
      keyId: "k1",
      sellerId: SELLER,
    })
    for (const k of ENV_KEYS) {
      setAll()
      delete process.env[k]
      expect(blackMaskProvisioningConfig()).toBeNull()
    }
  })

  it("refuses plain http in production and a malformed URL anywhere", () => {
    setAll()
    process.env.BLACK_MASK_PROVISIONING_URL = "http://bm.internal/hooks"
    process.env.NODE_ENV = "production"
    expect(blackMaskProvisioningConfig()).toBeNull()
    process.env.NODE_ENV = "test"
    expect(blackMaskProvisioningConfig()).not.toBeNull()
    process.env.BLACK_MASK_PROVISIONING_URL = "not a url"
    expect(blackMaskProvisioningConfig()).toBeNull()
  })
})
