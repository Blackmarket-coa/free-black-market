import {
  VERIFICATION_TTL_MS,
  checkVerificationToken,
  consumedState,
  isEmailVerified,
  issueVerificationToken,
} from "../seller-email-verification";

describe("seller email verification", () => {
  it("issues a high-entropy token and stores only its hash", () => {
    const { token, state } = issueVerificationToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    // The stored state must not contain the token in any form — the requests
    // table is readable by every admin and shows up in support tooling.
    expect(JSON.stringify(state)).not.toContain(token);
    expect(state.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issues a different token every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) seen.add(issueVerificationToken().token);
    expect(seen.size).toBe(50);
  });

  it("accepts the token it issued", () => {
    const { token, state } = issueVerificationToken();
    expect(checkVerificationToken(state, token)).toEqual({ ok: true });
  });

  it("refuses a wrong token, an empty one, and a near miss", () => {
    const { token, state } = issueVerificationToken();
    for (const wrong of [
      "",
      "nope",
      token.slice(0, -1),
      `${token}x`,
      token.toUpperCase(),
    ]) {
      expect(checkVerificationToken(state, wrong)).toEqual({
        ok: false,
        reason: "mismatch",
      });
    }
  });

  it("refuses once expired", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const { token, state } = issueVerificationToken(now);
    const justInside = new Date(now.getTime() + VERIFICATION_TTL_MS - 1000);
    const justOutside = new Date(now.getTime() + VERIFICATION_TTL_MS + 1000);
    expect(checkVerificationToken(state, token, justInside)).toEqual({
      ok: true,
    });
    expect(checkVerificationToken(state, token, justOutside)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("reports mismatch rather than expiry for a wrong token on an expired state", () => {
    // Otherwise "expired" confirms a guessed token was otherwise correct.
    const now = new Date("2026-01-01T00:00:00.000Z");
    const { state } = issueVerificationToken(now);
    const later = new Date(now.getTime() + VERIFICATION_TTL_MS + 1000);
    expect(checkVerificationToken(state, "guess", later)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("is single use: a consumed state refuses the token that opened it", () => {
    const { token, state } = issueVerificationToken();
    expect(checkVerificationToken(state, token)).toEqual({ ok: true });
    const after = consumedState();
    expect(checkVerificationToken(after, token)).toEqual({
      ok: false,
      reason: "already_verified",
    });
    expect(isEmailVerified(after)).toBe(true);
    expect(after.token_hash).toBe("");
  });

  it("treats absent or malformed state as not requested, never as a pass", () => {
    expect(checkVerificationToken(undefined, "anything")).toEqual({
      ok: false,
      reason: "not_requested",
    });
    expect(
      checkVerificationToken(
        { token_hash: "", expires_at: new Date().toISOString() },
        "",
      ),
    ).toEqual({ ok: false, reason: "not_requested" });
    // A corrupt hash must fail closed, not throw a 500 out of timingSafeEqual.
    expect(
      checkVerificationToken(
        {
          token_hash: "zzzz",
          expires_at: new Date(Date.now() + 1000).toISOString(),
        },
        "anything",
      ),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("an unverified state does not read as verified", () => {
    expect(isEmailVerified(undefined)).toBe(false);
    expect(isEmailVerified(issueVerificationToken().state)).toBe(false);
  });
});
