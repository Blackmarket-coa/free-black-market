import { resolveBlackstarVerificationSecret } from "../resolve-verification-secret"

const GLOBAL = "global-outbound-secret"

describe("resolveBlackstarVerificationSecret", () => {
  const lookupTable: Record<string, { id: string; secret: string }> = {
    fbk_known: { id: "cred_1", secret: "per-partner-secret" },
  }
  const lookup = async (keyId: string) => lookupTable[keyId] ?? null

  it("resolves a known key id to its credential secret", async () => {
    const r = await resolveBlackstarVerificationSecret({
      keyIdHeader: "fbk_known",
      lookup,
      globalSecret: GLOBAL,
      requireKeyId: false,
    })
    expect(r).toEqual({ ok: true, secret: "per-partner-secret", credentialId: "cred_1" })
  })

  it("answers an unknown key id exactly like a bad signature", async () => {
    const r = await resolveBlackstarVerificationSecret({
      keyIdHeader: "fbk_unknown",
      lookup,
      globalSecret: GLOBAL,
      requireKeyId: false,
    })
    expect(r).toEqual({ ok: false, status: 401, message: "Invalid signature." })
  })

  it("never falls back to the global secret when a key id is named", async () => {
    // Even with a perfectly good global secret configured, a named-but-unknown
    // key id must not verify against it.
    const r = await resolveBlackstarVerificationSecret({
      keyIdHeader: "fbk_unknown",
      lookup,
      globalSecret: GLOBAL,
      requireKeyId: false,
    })
    expect(r.ok).toBe(false)
  })

  it("falls back to the global secret without a key id while migrating", async () => {
    const r = await resolveBlackstarVerificationSecret({
      keyIdHeader: undefined,
      lookup,
      globalSecret: GLOBAL,
      requireKeyId: false,
    })
    expect(r).toEqual({ ok: true, secret: GLOBAL, credentialId: null })
  })

  it("retires the global secret when key ids are required", async () => {
    const r = await resolveBlackstarVerificationSecret({
      keyIdHeader: "",
      lookup,
      globalSecret: GLOBAL,
      requireKeyId: true,
    })
    expect(r).toEqual({ ok: false, status: 401, message: "Key ID required." })
  })

  it("fails closed with 503 when nothing is configured", async () => {
    const r = await resolveBlackstarVerificationSecret({
      keyIdHeader: undefined,
      lookup,
      globalSecret: undefined,
      requireKeyId: false,
    })
    expect(r).toEqual({
      ok: false,
      status: 503,
      message: "Blackstar signature verification is not configured.",
    })
  })
})
