import { describe, expect, it } from "vitest"
import {
  HANDOFF_TOKEN_TTL_MS,
  mintHandoffToken,
  verifyHandoffToken,
} from "@/lib/native/checkout-handoff"
import { deepLinkToPath, sanitizeRedirectPath } from "@/lib/native/deep-links"

const SECRET = "test-secret"

describe("handoff tokens", () => {
  it("round-trips a cart id", () => {
    const token = mintHandoffToken("cart_01ABC", SECRET)
    expect(verifyHandoffToken(token, SECRET)).toBe("cart_01ABC")
  })

  it("survives cart ids containing the separator", () => {
    const token = mintHandoffToken("cart|weird", SECRET)
    expect(verifyHandoffToken(token, SECRET)).toBe("cart|weird")
  })

  it("rejects tampered payloads and signatures", () => {
    const token = mintHandoffToken("cart_01ABC", SECRET)
    const [payload, signature] = token.split(".")
    const otherPayload = Buffer.from(
      `cart_EVIL|${Date.now() + HANDOFF_TOKEN_TTL_MS}`
    ).toString("base64url")
    expect(verifyHandoffToken(`${otherPayload}.${signature}`, SECRET)).toBeNull()
    expect(verifyHandoffToken(`${payload}.AAAA`, SECRET)).toBeNull()
    expect(verifyHandoffToken(payload, SECRET)).toBeNull()
    expect(verifyHandoffToken("", SECRET)).toBeNull()
  })

  it("rejects tokens minted with another secret", () => {
    const token = mintHandoffToken("cart_01ABC", "other-secret")
    expect(verifyHandoffToken(token, SECRET)).toBeNull()
  })

  it("expires after the TTL", () => {
    const mintedAt = 1_000_000
    const token = mintHandoffToken("cart_01ABC", SECRET, mintedAt)
    expect(
      verifyHandoffToken(token, SECRET, mintedAt + HANDOFF_TOKEN_TTL_MS - 1)
    ).toBe("cart_01ABC")
    expect(
      verifyHandoffToken(token, SECRET, mintedAt + HANDOFF_TOKEN_TTL_MS + 1)
    ).toBeNull()
  })
})

describe("sanitizeRedirectPath", () => {
  it("keeps plain absolute paths", () => {
    expect(sanitizeRedirectPath("/us/checkout?step=address")).toBe(
      "/us/checkout?step=address"
    )
  })

  it("rejects open-redirect shapes", () => {
    expect(sanitizeRedirectPath("https://evil.example")).toBe("/")
    expect(sanitizeRedirectPath("//evil.example")).toBe("/")
    expect(sanitizeRedirectPath("/\\evil.example")).toBe("/")
    expect(sanitizeRedirectPath("/path with space")).toBe("/")
    expect(sanitizeRedirectPath("relative/path")).toBe("/")
    expect(sanitizeRedirectPath(null)).toBe("/")
    expect(sanitizeRedirectPath(undefined, "/cart")).toBe("/cart")
  })
})

describe("deepLinkToPath", () => {
  it("maps host/path deep links to storefront paths", () => {
    expect(deepLinkToPath("fbm://cart")).toBe("/cart")
    expect(deepLinkToPath("fbm://products/basil")).toBe("/products/basil")
    expect(deepLinkToPath("fbm://products/basil?ref=x")).toBe(
      "/products/basil?ref=x"
    )
  })

  it("honours the explicit path form", () => {
    expect(deepLinkToPath("fbm://open?path=/us/products/basil")).toBe(
      "/us/products/basil"
    )
    expect(deepLinkToPath("fbm://open?path=//evil.example")).toBeNull()
    expect(deepLinkToPath("fbm://open")).toBeNull()
  })

  it("ignores other schemes and garbage", () => {
    expect(deepLinkToPath("https://freeblackmarket.com/us")).toBeNull()
    expect(deepLinkToPath("blackout://room/x")).toBeNull()
    expect(deepLinkToPath("not a url")).toBeNull()
    expect(deepLinkToPath(null)).toBeNull()
    expect(deepLinkToPath(undefined)).toBeNull()
  })
})
