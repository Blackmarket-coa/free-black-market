import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { detectEmbedContext, getAllowedEmbedOrigins } from "@/lib/runtime/embed-context"

function makeHeaders(map: Record<string, string>) {
  return {
    get(name: string): string | null {
      return map[name.toLowerCase()] ?? null
    },
  }
}

describe("detectEmbedContext", () => {
  const ORIG_ENV = process.env.BLACKOUT_EMBED_ALLOWED_ORIGINS

  beforeEach(() => {
    process.env.BLACKOUT_EMBED_ALLOWED_ORIGINS =
      "capacitor://localhost, https://blackout.bmc.example"
  })

  afterEach(() => {
    if (ORIG_ENV === undefined) delete process.env.BLACKOUT_EMBED_ALLOWED_ORIGINS
    else process.env.BLACKOUT_EMBED_ALLOWED_ORIGINS = ORIG_ENV
  })

  it("returns isEmbedded=false when X-FBM-Embed-Origin is missing", () => {
    const ctx = detectEmbedContext(makeHeaders({}))
    expect(ctx.isEmbedded).toBe(false)
    expect(ctx.origin).toBeNull()
    expect(ctx.isAllowedOrigin).toBe(false)
  })

  it("flags allowlisted origins as allowed", () => {
    const ctx = detectEmbedContext(
      makeHeaders({ "x-fbm-embed-origin": "capacitor://localhost" })
    )
    expect(ctx.isEmbedded).toBe(true)
    expect(ctx.origin).toBe("capacitor://localhost")
    expect(ctx.isAllowedOrigin).toBe(true)
  })

  it("treats origin matching as case-insensitive", () => {
    const ctx = detectEmbedContext(
      makeHeaders({ "x-fbm-embed-origin": "HTTPS://Blackout.BMC.Example" })
    )
    expect(ctx.isAllowedOrigin).toBe(true)
  })

  it("rejects origins not in the allowlist", () => {
    const ctx = detectEmbedContext(
      makeHeaders({ "x-fbm-embed-origin": "https://malicious.example" })
    )
    expect(ctx.isEmbedded).toBe(true)
    expect(ctx.isAllowedOrigin).toBe(false)
  })
})

describe("getAllowedEmbedOrigins", () => {
  it("parses a comma-separated env var ignoring whitespace and empty entries", () => {
    process.env.BLACKOUT_EMBED_ALLOWED_ORIGINS =
      "  capacitor://localhost ,, https://blackout.bmc.example  ,"
    expect(getAllowedEmbedOrigins()).toEqual([
      "capacitor://localhost",
      "https://blackout.bmc.example",
    ])
  })

  it("returns an empty array when the env var is unset", () => {
    delete process.env.BLACKOUT_EMBED_ALLOWED_ORIGINS
    expect(getAllowedEmbedOrigins()).toEqual([])
  })
})
