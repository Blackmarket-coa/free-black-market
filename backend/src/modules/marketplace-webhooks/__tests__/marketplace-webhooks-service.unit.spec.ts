import { createHmac } from "crypto"
import { signWithSecret } from "../service"
import { MARKETPLACE_WEBHOOK_EVENTS } from "../models/webhook-subscription"

describe("marketplace-webhooks service helpers", () => {
  it("signWithSecret produces an HMAC-SHA256 hex digest matching crypto.createHmac", () => {
    const body = JSON.stringify({ id: "evt_1", event: "creator.payout.completed" })
    const secret = "fbm_whsec_abcdef0123456789"

    const expected = createHmac("sha256", secret).update(body).digest("hex")
    expect(signWithSecret(secret, body)).toBe(expected)
  })

  it("exports the three original contract events alongside any extensions", () => {
    // The list grows as new modules add events (creator-attribution,
    // creator-program, creator-rewards, service-program, etc.). Assert the
    // original three are still present and that there are no duplicates.
    expect(MARKETPLACE_WEBHOOK_EVENTS).toEqual(
      expect.arrayContaining([
        "creator.payout.completed",
        "listing.signed_bundle.published",
        "creator.account.suspended",
      ])
    )
    const unique = new Set(MARKETPLACE_WEBHOOK_EVENTS)
    expect(unique.size).toBe(MARKETPLACE_WEBHOOK_EVENTS.length)
  })
})
