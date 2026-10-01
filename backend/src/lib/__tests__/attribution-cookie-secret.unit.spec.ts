import { resolveAttributionCookieSecret } from "../attribution-cookie-secret"

const SIGNING_KEY = "k".repeat(32)
const JWT = "j".repeat(32)

describe("resolveAttributionCookieSecret", () => {
  it("prefers STOREFRONT_VISITOR_SIGNING_KEY when set", () => {
    expect(
      resolveAttributionCookieSecret({
        STOREFRONT_VISITOR_SIGNING_KEY: SIGNING_KEY,
        JWT_SECRET: JWT,
      })
    ).toBe(SIGNING_KEY)
  })

  it("falls back to JWT_SECRET when the signing key is unset", () => {
    expect(resolveAttributionCookieSecret({ JWT_SECRET: JWT })).toBe(JWT)
  })

  it("returns null when neither is set (never a literal default)", () => {
    expect(resolveAttributionCookieSecret({})).toBeNull()
  })

  it("treats blank and whitespace-only values as unset", () => {
    expect(
      resolveAttributionCookieSecret({
        STOREFRONT_VISITOR_SIGNING_KEY: "",
        JWT_SECRET: "   ",
      })
    ).toBeNull()
    expect(
      resolveAttributionCookieSecret({
        STOREFRONT_VISITOR_SIGNING_KEY: " \t\n",
        JWT_SECRET: JWT,
      })
    ).toBe(JWT)
  })

  it("reads process.env by default", () => {
    const saved = {
      signing: process.env.STOREFRONT_VISITOR_SIGNING_KEY,
      jwt: process.env.JWT_SECRET,
    }
    try {
      delete process.env.STOREFRONT_VISITOR_SIGNING_KEY
      process.env.JWT_SECRET = JWT
      expect(resolveAttributionCookieSecret()).toBe(JWT)
      delete process.env.JWT_SECRET
      expect(resolveAttributionCookieSecret()).toBeNull()
    } finally {
      if (saved.signing === undefined) {
        delete process.env.STOREFRONT_VISITOR_SIGNING_KEY
      } else {
        process.env.STOREFRONT_VISITOR_SIGNING_KEY = saved.signing
      }
      if (saved.jwt === undefined) {
        delete process.env.JWT_SECRET
      } else {
        process.env.JWT_SECRET = saved.jwt
      }
    }
  })
})
