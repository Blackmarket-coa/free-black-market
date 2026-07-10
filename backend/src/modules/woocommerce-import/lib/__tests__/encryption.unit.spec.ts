import { encrypt, decrypt } from "../encryption"

describe("woocommerce-import encryption", () => {
  const OLD = { woo: process.env.WOO_ENCRYPTION_KEY, jwt: process.env.JWT_SECRET }

  beforeEach(() => {
    process.env.WOO_ENCRYPTION_KEY = "unit-test-woo-encryption-key-000000"
    delete process.env.JWT_SECRET
  })

  afterAll(() => {
    if (OLD.woo === undefined) delete process.env.WOO_ENCRYPTION_KEY
    else process.env.WOO_ENCRYPTION_KEY = OLD.woo
    if (OLD.jwt === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = OLD.jwt
  })

  it("round-trips a value", () => {
    const secret = "ck_super_secret_value"
    const enc = encrypt(secret)
    expect(enc).not.toContain(secret)
    expect(enc.split(":")).toHaveLength(3) // iv:tag:ciphertext
    expect(decrypt(enc)).toBe(secret)
  })

  it("produces a fresh IV each time (ciphertext differs)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"))
  })

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const enc = encrypt("value")
    const [iv, tag, data] = enc.split(":")
    const flipped = data.slice(0, -1) + (data.endsWith("0") ? "1" : "0")
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow()
  })

  it("falls back to JWT_SECRET when WOO_ENCRYPTION_KEY is unset", () => {
    delete process.env.WOO_ENCRYPTION_KEY
    process.env.JWT_SECRET = "jwt-secret-fallback-000000000000"
    const enc = encrypt("value")
    expect(decrypt(enc)).toBe("value")
  })

  it("throws when no key is configured at all", () => {
    delete process.env.WOO_ENCRYPTION_KEY
    delete process.env.JWT_SECRET
    expect(() => encrypt("value")).toThrow()
  })
})
