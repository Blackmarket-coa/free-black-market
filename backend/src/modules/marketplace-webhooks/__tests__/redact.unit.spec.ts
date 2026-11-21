import { REDACTED, redactSecrets, scrubSecretsFrom } from "../redact"

/**
 * Secrets in a stored delivery's payload. The `node.operator.approved`
 * envelope carries a node credential's secret, which the admin deliveries
 * route returned in plaintext and the table kept for good (measured on
 * Postgres; the routes and the table are pinned by
 * integration-tests/http/vendor-onboarding-journey.spec.ts).
 */
describe("redactSecrets", () => {
  const envelope = () => ({
    event_id: "evt_1",
    event_type: "node.operator.approved",
    correlation_id: "evt_1",
    payload: {
      external_ref: "sel_1",
      seller_id: "sel_1",
      member_email: "ops@crosstown.test",
      credential: { key_id: "bsk_abc", secret: "a".repeat(64) },
    },
  })

  it("replaces the credential's secret and keeps everything else, the key id included", () => {
    expect(redactSecrets(envelope())).toEqual({
      event_id: "evt_1",
      event_type: "node.operator.approved",
      correlation_id: "evt_1",
      payload: {
        external_ref: "sel_1",
        seller_id: "sel_1",
        member_email: "ops@crosstown.test",
        credential: { key_id: "bsk_abc", secret: REDACTED },
      },
    })
  })

  it("leaves the value it was given untouched", () => {
    const original = envelope()
    redactSecrets(original)
    expect(original.payload.credential.secret).toBe("a".repeat(64))
  })

  it("finds a secret wherever it sits: nested, in a list, under any key ending in secret", () => {
    expect(
      redactSecrets({
        client_secret: "x",
        signingSecret: "y",
        items: [{ secret: "z", name: "kept" }],
        deep: { deeper: { SECRET: "w" } },
      })
    ).toEqual({
      client_secret: REDACTED,
      signingSecret: REDACTED,
      items: [{ secret: REDACTED, name: "kept" }],
      deep: { deeper: { SECRET: REDACTED } },
    })
  })

  it("changes nothing in a payload with no secret, and is stable on one already redacted", () => {
    const order = { event_type: "order.created", payload: { source_order_ref: "ord_1", secretary: "Sam" } }
    expect(redactSecrets(order)).toEqual(order)
    expect(redactSecrets(redactSecrets(envelope()))).toEqual(redactSecrets(envelope()))
    expect(redactSecrets({ secret: null })).toEqual({ secret: null })
    expect(redactSecrets(null)).toBeNull()
    expect(redactSecrets("secret")).toBe("secret")
  })
})

describe("scrubSecretsFrom", () => {
  const payload = { payload: { credential: { key_id: "bsk_abc", secret: "a".repeat(64) } } }

  it("takes the payload's secret out of a response that echoes it", () => {
    const echoed = `422 {"received":{"credential":{"key_id":"bsk_abc","secret":"${"a".repeat(64)}"}}}`
    expect(scrubSecretsFrom(echoed, payload)).toBe(
      `422 {"received":{"credential":{"key_id":"bsk_abc","secret":"${REDACTED}"}}}`
    )
  })

  it("leaves any other response as it is", () => {
    expect(scrubSecretsFrom("boom", payload)).toBe("boom")
    expect(scrubSecretsFrom(null, payload)).toBeNull()
    expect(scrubSecretsFrom("the secret is safe", { payload: {} })).toBe("the secret is safe")
  })
})

