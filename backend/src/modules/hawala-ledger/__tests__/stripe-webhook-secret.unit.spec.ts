/**
 * `StripeAchService.handleWebhook` refuses to verify against an empty secret.
 *
 * `createStripeAchService` reads `STRIPE_WEBHOOK_SECRET || ""`, and the secret
 * is optional in `shared/config.ts`. Stripe signs with HMAC-SHA256, and an
 * HMAC with a zero-length key is something anyone can compute: on Postgres,
 * with the secret unset, `POST /webhooks/vendor-billing/stripe` took a
 * `payment_intent.succeeded` signed with the empty key and marked a pending
 * vendor charge paid (`integration-tests/http/bare-prefix-authz.spec.ts`).
 * The real Stripe library does the verifying here; nothing is stubbed.
 */
import { createHmac } from "crypto"
import { StripeAchService } from "../stripe-ach"

const service = (stripeWebhookSecret: string) =>
  new StripeAchService({
    stripeSecretKey: "sk_test_unused",
    stripeWebhookSecret,
    platformFeePercentage: 0.008,
    platformFeeMax: 5,
  })

const payload = Buffer.from(
  JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_1", object: "payment_intent", metadata: { type: "vendor_charge", charge_id: "vchg_1" } } },
  })
)

const signatureWith = (key: string) => {
  const t = Math.floor(Date.now() / 1000)
  return `t=${t},v1=${createHmac("sha256", key).update(`${t}.${payload.toString()}`).digest("hex")}`
}

const SECRET = "whsec_stripe_webhook_secret_unit_spec"

describe("StripeAchService.handleWebhook", () => {
  it("with no secret configured, refuses an event signed with the empty key", async () => {
    await expect(service("").handleWebhook(payload, signatureWith(""))).rejects.toThrow(
      "STRIPE_WEBHOOK_SECRET is not set"
    )
  })

  it("with no secret configured, refuses any other signature the same way", async () => {
    await expect(service("").handleWebhook(payload, signatureWith(SECRET))).rejects.toThrow(
      "STRIPE_WEBHOOK_SECRET is not set"
    )
  })

  it("with the secret configured, accepts Stripe's signature and returns the event", async () => {
    await expect(service(SECRET).handleWebhook(payload, signatureWith(SECRET))).resolves.toMatchObject({
      type: "payment_intent.succeeded",
      data: { id: "pi_1", metadata: { type: "vendor_charge", charge_id: "vchg_1" } },
    })
  })

  it("with the secret configured, refuses the empty-key signature and a wrong key", async () => {
    await expect(service(SECRET).handleWebhook(payload, signatureWith(""))).rejects.toThrow(/signature/i)
    await expect(service(SECRET).handleWebhook(payload, signatureWith("whsec_other"))).rejects.toThrow(/signature/i)
  })
})
