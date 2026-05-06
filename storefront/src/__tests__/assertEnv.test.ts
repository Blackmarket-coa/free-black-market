import { afterEach, describe, expect, it } from "vitest"
import { assertProductionEnv } from "../lib/config/assertEnv"

const baseProdEnv = {
  NODE_ENV: "production",
  REVALIDATE_SECRET: "a".repeat(32),
  NEXT_PUBLIC_STRIPE_KEY: "pk_live_realstripekey",
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_real_publishable_key",
} as unknown as NodeJS.ProcessEnv

describe("assertProductionEnv", () => {
  afterEach(() => {
    // No-op: each test passes its own env object.
  })

  it("returns ok for non-production", () => {
    const { ok, errors } = assertProductionEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv)
    expect(ok).toBe(true)
    expect(errors).toEqual([])
  })

  it("returns ok for a fully populated production env", () => {
    const { ok, errors } = assertProductionEnv(baseProdEnv)
    expect(errors).toEqual([])
    expect(ok).toBe(true)
  })

  it("rejects banned literal NEXT_PUBLIC_STRIPE_KEY", () => {
    const env = { ...baseProdEnv, NEXT_PUBLIC_STRIPE_KEY: "supersecret" }
    const { ok, errors } = assertProductionEnv(env)
    expect(ok).toBe(false)
    expect(errors.join("\n")).toMatch(/NEXT_PUBLIC_STRIPE_KEY/)
  })

  it("rejects CHANGE_ME prefixed REVALIDATE_SECRET", () => {
    const env = { ...baseProdEnv, REVALIDATE_SECRET: "CHANGE_ME_revalidate_secret_min_32_chars" }
    const { ok, errors } = assertProductionEnv(env)
    expect(ok).toBe(false)
    expect(errors.join("\n")).toMatch(/REVALIDATE_SECRET/)
  })

  it("rejects under-length REVALIDATE_SECRET", () => {
    const env = { ...baseProdEnv, REVALIDATE_SECRET: "tooshort" }
    const { ok, errors } = assertProductionEnv(env)
    expect(ok).toBe(false)
    expect(errors.join("\n")).toMatch(/REVALIDATE_SECRET/)
  })

  it("rejects invalid Stripe key format", () => {
    const env = { ...baseProdEnv, NEXT_PUBLIC_STRIPE_KEY: "sk_live_secret_key" }
    const { ok, errors } = assertProductionEnv(env)
    expect(ok).toBe(false)
    expect(errors.join("\n")).toMatch(/NEXT_PUBLIC_STRIPE_KEY/)
  })

  it("rejects missing required keys", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv
    const { ok, errors } = assertProductionEnv(env)
    expect(ok).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })
})
