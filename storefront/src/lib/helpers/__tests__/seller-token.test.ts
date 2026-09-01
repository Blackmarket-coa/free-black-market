import { describe, expect, it } from "vitest"
import {
  SELLER_TOKEN_REFRESH_WINDOW_MS,
  decodeJwtPayload,
  isTokenExpired,
  readSellerClaims,
  shouldRefreshToken,
} from "../seller-token"

const b64url = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url")

/** Build an unsigned token shaped like Medusa's — signature is never read. */
const makeToken = (payload: Record<string, unknown>): string =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`

const NOW = 1_700_000_000_000

describe("decodeJwtPayload", () => {
  it("decodes a well-formed payload", () => {
    const token = makeToken({ actor_type: "seller", foo: "bar" })
    expect(decodeJwtPayload(token)).toMatchObject({
      actor_type: "seller",
      foo: "bar",
    })
  })

  it("returns null for absent or malformed tokens", () => {
    expect(decodeJwtPayload(null)).toBeNull()
    expect(decodeJwtPayload(undefined)).toBeNull()
    expect(decodeJwtPayload("")).toBeNull()
    expect(decodeJwtPayload("not-a-jwt")).toBeNull()
    expect(decodeJwtPayload("a.!!!notbase64!!!.c")).toBeNull()
  })

  it("returns null when the payload is not an object", () => {
    expect(decodeJwtPayload(`h.${b64url([1, 2, 3] as never)}.s`)).not.toBeNull()
    expect(
      decodeJwtPayload(`h.${Buffer.from('"a string"').toString("base64url")}.s`)
    ).toBeNull()
  })
})

describe("readSellerClaims", () => {
  it("pulls seller_id out of app_metadata", () => {
    const token = makeToken({
      actor_type: "seller",
      app_metadata: { seller_id: "sel_123" },
      exp: NOW / 1000 + 3600,
    })
    expect(readSellerClaims(token)).toEqual({
      seller_id: "sel_123",
      actor_type: "seller",
      expires_at: NOW + 3_600_000,
    })
  })

  it("reports a null seller_id when app_metadata lacks one", () => {
    const token = makeToken({ actor_type: "customer", app_metadata: {} })
    expect(readSellerClaims(token)?.seller_id).toBeNull()
  })

  it("tolerates a missing exp", () => {
    const token = makeToken({ app_metadata: { seller_id: "sel_1" } })
    expect(readSellerClaims(token)?.expires_at).toBeNull()
  })
})

describe("isTokenExpired", () => {
  it("treats absent and malformed tokens as expired", () => {
    expect(isTokenExpired(null, NOW)).toBe(true)
    expect(isTokenExpired("garbage", NOW)).toBe(true)
  })

  it("compares against exp", () => {
    const live = makeToken({ exp: NOW / 1000 + 60 })
    const dead = makeToken({ exp: NOW / 1000 - 60 })
    expect(isTokenExpired(live, NOW)).toBe(false)
    expect(isTokenExpired(dead, NOW)).toBe(true)
  })

  it("treats a token with no exp as live", () => {
    expect(isTokenExpired(makeToken({}), NOW)).toBe(false)
  })
})

describe("shouldRefreshToken", () => {
  it("refreshes inside the window", () => {
    const token = makeToken({
      exp: (NOW + SELLER_TOKEN_REFRESH_WINDOW_MS - 60_000) / 1000,
    })
    expect(shouldRefreshToken(token, NOW)).toBe(true)
  })

  it("does not refresh a token with plenty of life left", () => {
    const token = makeToken({
      exp: (NOW + SELLER_TOKEN_REFRESH_WINDOW_MS + 60_000) / 1000,
    })
    expect(shouldRefreshToken(token, NOW)).toBe(false)
  })

  it("does not refresh an already-dead token — that needs a re-login", () => {
    expect(shouldRefreshToken(makeToken({ exp: NOW / 1000 - 1 }), NOW)).toBe(
      false
    )
  })

  it("does not refresh absent or exp-less tokens", () => {
    expect(shouldRefreshToken(null, NOW)).toBe(false)
    expect(shouldRefreshToken(makeToken({}), NOW)).toBe(false)
  })
})
