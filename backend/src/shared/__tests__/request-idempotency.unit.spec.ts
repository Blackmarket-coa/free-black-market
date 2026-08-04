import { resolveRequestIdempotencyKey } from "../request-idempotency"

describe("resolveRequestIdempotencyKey", () => {
  const base = {
    scope: "deposit",
    actorId: "cus_1",
    payload: { amount: 50, bank_account_id: "ba_1" },
  }

  it("prefers the Idempotency-Key header and is stable across retries", () => {
    const first = resolveRequestIdempotencyKey({
      ...base,
      headers: { "idempotency-key": "abc-123" },
      nowMs: 1_000,
    })
    const retry = resolveRequestIdempotencyKey({
      ...base,
      headers: { "idempotency-key": "abc-123" },
      // A retry lands later, and in a different bucket — the header must
      // still win, so the key does not move.
      nowMs: 9_999_999,
    })

    expect(first.source).toBe("header")
    expect(first.key).toBe(retry.key)
  })

  it("scopes keys by actor so two customers cannot collide", () => {
    const a = resolveRequestIdempotencyKey({
      ...base,
      actorId: "cus_a",
      headers: { "idempotency-key": "same-key" },
    })
    const b = resolveRequestIdempotencyKey({
      ...base,
      actorId: "cus_b",
      headers: { "idempotency-key": "same-key" },
    })

    expect(a.key).not.toBe(b.key)
  })

  it("scopes keys by operation so a deposit and a withdrawal cannot collide", () => {
    const deposit = resolveRequestIdempotencyKey({
      ...base,
      scope: "deposit",
      headers: { "idempotency-key": "same-key" },
    })
    const withdraw = resolveRequestIdempotencyKey({
      ...base,
      scope: "withdraw",
      headers: { "idempotency-key": "same-key" },
    })

    expect(deposit.key).not.toBe(withdraw.key)
  })

  it("falls back to the body key, matching the vendor-hype precedent", () => {
    const resolved = resolveRequestIdempotencyKey({
      ...base,
      body: { idempotency_key: "from-body" },
    })

    expect(resolved.source).toBe("body")
    expect(resolved.key).toBe(
      resolveRequestIdempotencyKey({
        ...base,
        body: { idempotency_key: "from-body" },
        nowMs: 123_456_789,
      }).key
    )
  })

  it("ignores blank header and body values", () => {
    const resolved = resolveRequestIdempotencyKey({
      ...base,
      headers: { "idempotency-key": "   " },
      body: { idempotency_key: "" },
      nowMs: 1_000,
    })

    expect(resolved.source).toBe("derived")
  })

  it("collapses an immediate retry when the client sends no key", () => {
    const first = resolveRequestIdempotencyKey({ ...base, nowMs: 1_000 })
    const retry = resolveRequestIdempotencyKey({ ...base, nowMs: 3_000 })

    expect(first.source).toBe("derived")
    expect(first.key).toBe(retry.key)
  })

  it("does not collapse a different amount in the same bucket", () => {
    const fifty = resolveRequestIdempotencyKey({ ...base, nowMs: 1_000 })
    const sixty = resolveRequestIdempotencyKey({
      ...base,
      payload: { amount: 60, bank_account_id: "ba_1" },
      nowMs: 1_000,
    })

    expect(fifty.key).not.toBe(sixty.key)
  })

  it("lets a deliberate identical repeat proceed in a later bucket", () => {
    const now = resolveRequestIdempotencyKey({ ...base, nowMs: 1_000 })
    const muchLater = resolveRequestIdempotencyKey({
      ...base,
      nowMs: 1_000 + 16 * 60 * 1000,
    })

    expect(now.key).not.toBe(muchLater.key)
  })

  it("never produces a key containing a raw timestamp or uuid", () => {
    const resolved = resolveRequestIdempotencyKey({ ...base, nowMs: 1_700_000_000_000 })

    expect(resolved.key).not.toContain("1700000000000")
    expect(resolved.key).toMatch(/^deposit-cus_1-[0-9a-f]{32}$/)
  })
})
