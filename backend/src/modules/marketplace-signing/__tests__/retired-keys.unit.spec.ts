import { generateKeyPairSync } from "crypto"
import PluginSigningService from "../service"
import { buildPublishingKeysDocument } from "../verify"

/**
 * Signing-key rotation (W3-2).
 *
 * The published keyset held exactly one key, derived from whatever private
 * key was configured at the time. The Blackout client resolves a signature by
 * `keys.find((entry) => entry.keyId === signature.keyId)` and returns
 * `unknown-key-id` when nothing matches. So rotating
 * `MARKETPLACE_SIGNING_KEY_ID` made every artifact signed under the previous
 * key stop installing — not with a warning, with a refusal. Rotation was
 * unavailable in practice.
 *
 * The client already treats the document as a keyset, so publishing the
 * retired keys beside the active one is the whole fix on this side.
 */

const keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }
}

const ACTIVE = keypair()
const OLD = keypair()
const OLDER = keypair()

const service = () => new (PluginSigningService as unknown as new () => {
  getPublicKeyPem(): { keyId: string; pem: string }
  getRetiredPublicKeys(): Array<{ keyId: string; pem: string }>
})()

const withEnv = (retired?: string) => {
  process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = ACTIVE.privatePem
  process.env.MARKETPLACE_SIGNING_KEY_ID = "fbm-2026"
  if (retired === undefined) {
    delete process.env.MARKETPLACE_SIGNING_RETIRED_KEYS
  } else {
    process.env.MARKETPLACE_SIGNING_RETIRED_KEYS = retired
  }
}

afterEach(() => {
  delete process.env.MARKETPLACE_SIGNING_RETIRED_KEYS
  delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
  delete process.env.MARKETPLACE_SIGNING_KEY_ID
})

describe("getRetiredPublicKeys", () => {
  it("returns nothing when unset — the pre-rotation state stays unchanged", () => {
    withEnv()
    expect(service().getRetiredPublicKeys()).toEqual([])
  })

  it("returns nothing for an empty or whitespace value", () => {
    withEnv("   ")
    expect(service().getRetiredPublicKeys()).toEqual([])
  })

  it("reads several retired keys", () => {
    withEnv(
      JSON.stringify([
        { keyId: "fbm-2025", publicKeyPem: OLD.publicPem },
        { keyId: "fbm-2024", publicKeyPem: OLDER.publicPem },
      ])
    )

    const keys = service().getRetiredPublicKeys()
    expect(keys.map((k) => k.keyId)).toEqual(["fbm-2025", "fbm-2024"])
    expect(keys[0].pem).toContain("BEGIN PUBLIC KEY")
  })

  it("throws rather than silently dropping an unreadable key", () => {
    // Dropping it would stop every artifact signed under that key from
    // installing, and would surface as a user's install failing rather than
    // as a deploy failing. Loud at the endpoint beats quiet at the install.
    withEnv(JSON.stringify([{ keyId: "fbm-2025", publicKeyPem: "not a pem" }]))
    expect(() => service().getRetiredPublicKeys()).toThrow(/not a readable PEM/)
  })

  it("throws on malformed JSON", () => {
    withEnv("{oops")
    expect(() => service().getRetiredPublicKeys()).toThrow(/valid JSON/)
  })

  it("throws when the value is not an array", () => {
    withEnv(JSON.stringify({ keyId: "fbm-2025", publicKeyPem: OLD.publicPem }))
    expect(() => service().getRetiredPublicKeys()).toThrow(/JSON array/)
  })

  it("throws on an entry missing a field", () => {
    withEnv(JSON.stringify([{ keyId: "fbm-2025" }]))
    expect(() => service().getRetiredPublicKeys()).toThrow(/index 0/)
  })

  it("refuses a retired key that reuses the active key id", () => {
    // Two entries under one keyId make the client's `find` depend on array
    // order, which is not a thing to leave to chance in a signature check.
    withEnv(JSON.stringify([{ keyId: "fbm-2026", publicKeyPem: OLD.publicPem }]))
    expect(() => service().getRetiredPublicKeys()).toThrow(/also the active key id/)
  })

  it("refuses duplicate retired key ids", () => {
    withEnv(
      JSON.stringify([
        { keyId: "fbm-2025", publicKeyPem: OLD.publicPem },
        { keyId: "fbm-2025", publicKeyPem: OLDER.publicPem },
      ])
    )
    expect(() => service().getRetiredPublicKeys()).toThrow(/duplicate retired keyId/)
  })
})

describe("buildPublishingKeysDocument", () => {
  it("is unchanged when there are no retired keys", () => {
    const doc = buildPublishingKeysDocument({ keyId: "fbm-2026", pem: ACTIVE.publicPem })
    expect(doc.keys).toHaveLength(1)
    expect(doc.keys[0]).not.toHaveProperty("retired")
  })

  it("publishes the active key first, then the retired ones", () => {
    // The client looks up by keyId so order does not affect correctness, but
    // a consumer reaching for keys[0] — which the original single-key
    // document invited — must get the signing key, not a historical one.
    const doc = buildPublishingKeysDocument({
      keyId: "fbm-2026",
      pem: ACTIVE.publicPem,
      retired: [{ keyId: "fbm-2025", pem: OLD.publicPem }],
    })

    expect(doc.keys.map((k) => k.keyId)).toEqual(["fbm-2026", "fbm-2025"])
    expect(doc.keys[0].retired).toBeUndefined()
    expect(doc.keys[1].retired).toBe(true)
  })

  it("gives every key the base64 SPKI the client imports", () => {
    const doc = buildPublishingKeysDocument({
      keyId: "fbm-2026",
      pem: ACTIVE.publicPem,
      retired: [{ keyId: "fbm-2025", pem: OLD.publicPem }],
    })

    for (const key of doc.keys) {
      expect(key.alg).toBe("ed25519")
      expect(key.publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/)
      expect(key.publicKeyPem).toContain("BEGIN PUBLIC KEY")
    }
    // Distinct keys must not collapse to the same material.
    expect(doc.keys[0].publicKey).not.toBe(doc.keys[1].publicKey)
  })

  it("resolves a rotated-away key id, which is the point", () => {
    // Mirrors the client's lookup: keys.find(entry => entry.keyId === sig.keyId).
    const doc = buildPublishingKeysDocument({
      keyId: "fbm-2026",
      pem: ACTIVE.publicPem,
      retired: [{ keyId: "fbm-2025", pem: OLD.publicPem }],
    })

    const found = doc.keys.find((entry) => entry.keyId === "fbm-2025")
    expect(found).toBeDefined()
    expect(found?.publicKeyPem).toBe(OLD.publicPem)

    // And the failure it replaces: without the retired entry there is no
    // match, which the client reports as `unknown-key-id`.
    const before = buildPublishingKeysDocument({ keyId: "fbm-2026", pem: ACTIVE.publicPem })
    expect(before.keys.find((entry) => entry.keyId === "fbm-2025")).toBeUndefined()
  })
})
