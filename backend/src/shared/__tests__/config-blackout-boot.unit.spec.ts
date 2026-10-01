/**
 * §7: missing FREEBLACKMARKET_WEBHOOK_SECRET / FREEBLACKMARKET_API_KEY must
 * fail FBM boot in production. `config.ts` validates at import time, so we
 * re-require it under jest.isolateModules with a controlled environment.
 */
function loadConfigWith(env: Record<string, string | undefined>) {
  const saved = process.env
  process.env = { ...saved, ...env } as NodeJS.ProcessEnv
  try {
    let mod: any
    jest.isolateModules(() => {
      mod = require("../config")
    })
    return mod
  } finally {
    process.env = saved
  }
}

const baseProd = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://localhost:5432/fbm",
  JWT_SECRET: "x".repeat(40),
  COOKIE_SECRET: "y".repeat(40),
  CREATOR_ATTRIBUTION_IP_SALT: "z".repeat(64),
}

describe("config boot — Blackout secrets (§7)", () => {
  it("boots in production when both Blackout secrets are present", () => {
    expect(() =>
      loadConfigWith({
        ...baseProd,
        FREEBLACKMARKET_WEBHOOK_SECRET: "whsec",
        FREEBLACKMARKET_API_KEY: "apikey",
      })
    ).not.toThrow()
  })

  it("throws in production when FREEBLACKMARKET_WEBHOOK_SECRET is missing", () => {
    expect(() =>
      loadConfigWith({
        ...baseProd,
        FREEBLACKMARKET_WEBHOOK_SECRET: undefined,
        FREEBLACKMARKET_API_KEY: "apikey",
      })
    ).toThrow(/FREEBLACKMARKET_WEBHOOK_SECRET is required in production/)
  })

  it("throws in production when FREEBLACKMARKET_API_KEY is missing", () => {
    expect(() =>
      loadConfigWith({
        ...baseProd,
        FREEBLACKMARKET_WEBHOOK_SECRET: "whsec",
        FREEBLACKMARKET_API_KEY: undefined,
      })
    ).toThrow(/FREEBLACKMARKET_API_KEY is required in production/)
  })

  it("does NOT require the Blackout secrets outside production", () => {
    expect(() =>
      loadConfigWith({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://localhost:5432/fbm",
        FREEBLACKMARKET_WEBHOOK_SECRET: undefined,
        FREEBLACKMARKET_API_KEY: undefined,
      })
    ).not.toThrow()
  })
})

describe("config boot — required secrets", () => {
  it("throws in production when COOKIE_SECRET is missing", () => {
    expect(() =>
      loadConfigWith({
        ...baseProd,
        COOKIE_SECRET: undefined,
        FREEBLACKMARKET_WEBHOOK_SECRET: "whsec",
        FREEBLACKMARKET_API_KEY: "apikey",
      })
    ).toThrow(/COOKIE_SECRET is required in production/)
  })

  it("does NOT require COOKIE_SECRET outside production", () => {
    expect(() =>
      loadConfigWith({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://localhost:5432/fbm",
        COOKIE_SECRET: undefined,
      })
    ).not.toThrow()
  })
})

describe("config boot — CREATOR_ATTRIBUTION_IP_SALT (LEG-8)", () => {
  const blackoutSecrets = {
    FREEBLACKMARKET_WEBHOOK_SECRET: "whsec",
    FREEBLACKMARKET_API_KEY: "apikey",
  }

  it("throws in production when CREATOR_ATTRIBUTION_IP_SALT is missing", () => {
    expect(() =>
      loadConfigWith({
        ...baseProd,
        ...blackoutSecrets,
        CREATOR_ATTRIBUTION_IP_SALT: undefined,
      })
    ).toThrow(/CREATOR_ATTRIBUTION_IP_SALT is required in production/)
  })

  it("throws in production when CREATOR_ATTRIBUTION_IP_SALT is blank", () => {
    expect(() =>
      loadConfigWith({
        ...baseProd,
        ...blackoutSecrets,
        CREATOR_ATTRIBUTION_IP_SALT: "   ",
      })
    ).toThrow(/CREATOR_ATTRIBUTION_IP_SALT is required in production/)
  })

  it("throws in production when CREATOR_ATTRIBUTION_IP_SALT is the template placeholder", () => {
    expect(() =>
      loadConfigWith({
        ...baseProd,
        FREEBLACKMARKET_WEBHOOK_SECRET: "whsec",
        FREEBLACKMARKET_API_KEY: "apikey",
        CREATOR_ATTRIBUTION_IP_SALT: "CHANGE_ME_creator_attribution_ip_salt_openssl_rand_hex_32",
      })
    ).toThrow(/CREATOR_ATTRIBUTION_IP_SALT is required in production/)
  })

  it("does NOT require CREATOR_ATTRIBUTION_IP_SALT outside production", () => {
    expect(() =>
      loadConfigWith({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://localhost:5432/fbm",
        CREATOR_ATTRIBUTION_IP_SALT: undefined,
      })
    ).not.toThrow()
  })
})
