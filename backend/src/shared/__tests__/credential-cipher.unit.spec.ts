import { ENC_PREFIX, createCredentialCipher } from "../credential-cipher"

/**
 * The channel connector was the one connection table storing a live marketplace
 * token in plaintext. These cover what closing that has to survive: rows that
 * were already written, a key that gets rotated, and a token that contains the
 * characters the WooCommerce helper's shape heuristic keys on.
 */

const ENV = { ...process.env }

const cipher = createCredentialCipher({
  envKeys: ["TEST_CRED_KEY", "TEST_CRED_KEY_PREVIOUS"],
  fallbackEnvKeys: ["TEST_FALLBACK_KEY"],
  salt: "unit-test-salt",
  label: "test",
})

beforeEach(() => {
  process.env = { ...ENV }
  delete process.env.TEST_CRED_KEY
  delete process.env.TEST_CRED_KEY_PREVIOUS
  delete process.env.TEST_FALLBACK_KEY
  process.env.TEST_CRED_KEY = "primary-key-for-unit-tests-0000000000"
})

afterAll(() => {
  process.env = ENV
})

describe("round trip", () => {
  it("returns what it was given", () => {
    const token = "faire_live_sk_abc123"
    expect(cipher.decrypt(cipher.encrypt(token))).toBe(token)
  })

  it("does not store the token in the clear", () => {
    const encrypted = cipher.encrypt("faire_live_sk_abc123")
    expect(encrypted).not.toContain("faire_live_sk_abc123")
    expect(encrypted.startsWith(ENC_PREFIX)).toBe(true)
  })

  it("produces a different ciphertext each time", () => {
    // A fresh IV per call. Identical ciphertext for identical input would leak
    // which vendors share a token, and would make the column its own oracle.
    const a = cipher.encrypt("same")
    const b = cipher.encrypt("same")
    expect(a).not.toBe(b)
    expect(cipher.decrypt(a)).toBe(cipher.decrypt(b))
  })

  it("survives a token full of the delimiters", () => {
    // The reason for a version prefix rather than the WooCommerce helper's
    // count-the-colons heuristic: a token may legitimately contain them, and a
    // heuristic would either mangle it or refuse it.
    const awkward = "a:b:c.d.e.f:::"
    expect(cipher.decrypt(cipher.encrypt(awkward))).toBe(awkward)
  })

  it("handles empty and unicode values", () => {
    expect(cipher.decrypt(cipher.encrypt(""))).toBe("")
    expect(cipher.decrypt(cipher.encrypt("tökén–✓"))).toBe("tökén–✓")
  })
})

describe("legacy plaintext", () => {
  it("reads a pre-encryption row through unchanged", () => {
    // Every existing `channel_connection` row is plaintext, and no migration
    // can fix that — the key lives in the environment, not the database. Without
    // this, deploying the change breaks every live connection at once.
    expect(cipher.decrypt("plain-legacy-token")).toBe("plain-legacy-token")
  })

  it("reports honestly which values are protected", () => {
    // What an operator script would count to know how much plaintext is left.
    expect(cipher.isEncrypted("plain-legacy-token")).toBe(false)
    expect(cipher.isEncrypted(cipher.encrypt("x"))).toBe(true)
  })

  it("reads plaintext even with no key configured at all", () => {
    delete process.env.TEST_CRED_KEY
    expect(cipher.decrypt("plain-legacy-token")).toBe("plain-legacy-token")
  })
})

describe("keys", () => {
  it("refuses to encrypt when nothing is configured", () => {
    // Never silently stores plaintext. A cipher that degrades quietly is worse
    // than none: the column looks protected and nothing ever says otherwise.
    delete process.env.TEST_CRED_KEY
    expect(() => cipher.encrypt("secret")).toThrow(/TEST_CRED_KEY/)
  })

  it("decrypts with a previous key after rotation", () => {
    // Without this, rotating means every stored credential becomes unreadable
    // the moment the variable changes — which in practice means never rotating.
    const old = cipher.encrypt("written-before-rotation")

    process.env.TEST_CRED_KEY = "a-brand-new-primary-key-1111111111"
    process.env.TEST_CRED_KEY_PREVIOUS = "primary-key-for-unit-tests-0000000000"

    expect(cipher.decrypt(old)).toBe("written-before-rotation")
    // And new writes use the new key.
    expect(cipher.decrypt(cipher.encrypt("after"))).toBe("after")
  })

  it("fails loudly when no configured key can decrypt", () => {
    const written = cipher.encrypt("secret")
    process.env.TEST_CRED_KEY = "an-unrelated-key-2222222222222222"
    delete process.env.TEST_CRED_KEY_PREVIOUS
    expect(() => cipher.decrypt(written)).toThrow(/any configured key/)
  })

  it("rejects a tampered ciphertext rather than returning garbage", () => {
    // GCM's authentication tag. Without the check, a modified row would decrypt
    // to nonsense and be sent to the channel as a bearer token.
    const written = cipher.encrypt("secret")
    const tampered = written.slice(0, -2) + (written.endsWith("ff") ? "aa" : "ff")
    expect(() => cipher.decrypt(tampered)).toThrow()
  })

  it("rejects a malformed value that claims the prefix", () => {
    expect(() => cipher.decrypt(`${ENC_PREFIX}not-three-parts`)).toThrow(
      /Malformed/
    )
  })

  it("falls back to the shared secret only when the dedicated key is absent", () => {
    delete process.env.TEST_CRED_KEY
    process.env.TEST_FALLBACK_KEY = "shared-secret-3333333333333333333"

    const written = cipher.encrypt("secret")
    expect(cipher.decrypt(written)).toBe("secret")

    // And the dedicated key wins the moment it exists — so setting it does not
    // silently keep using the shared one.
    process.env.TEST_CRED_KEY = "primary-key-for-unit-tests-0000000000"
    expect(() => cipher.decrypt(written)).toThrow(/any configured key/)
  })

  it("derives a different key from the same secret under a different salt", () => {
    // Domain separation. Under the shared-secret fallback this is what keeps a
    // channel token from being decryptable by anything else that happens to
    // read JWT_SECRET.
    const other = createCredentialCipher({
      envKeys: ["TEST_CRED_KEY"],
      salt: "a-different-domain",
      label: "other",
    })
    expect(() => other.decrypt(cipher.encrypt("secret"))).toThrow()
  })
})
