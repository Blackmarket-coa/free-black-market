import { readFileSync } from "fs"
import { createRequire } from "module"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Medusa's manual provider (`pp_system_default`) is never offered by a
 * production build.
 *
 * It places orders that are recorded as paid, and captured, with nobody
 * charged. The backend's seed scripts list it on the regions they create, and
 * the checkout offered every provider a region lists; only the badge calling
 * it a test was limited to development.
 *
 * What decides it is `process.env.NODE_ENV` in the built code, so this also
 * pins how a production build gets "production" there: Next writes it into
 * every bundle at `next build`, the storefront's Docker build runs
 * `next build` under `ENV NODE_ENV=production`, and nothing switches Next's
 * development build on. Whatever docker-compose or the runtime image set
 * NODE_ENV to afterwards does not reach the built code.
 */

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  getAuthHeaders: vi.fn(async () => null),
  getCacheOptions: vi.fn(async () => ({})),
}))

vi.mock("@/lib/config", () => ({ sdk: { client: { fetch: h.fetch } } }))
vi.mock("@/lib/data/cookies", () => ({
  getAuthHeaders: h.getAuthHeaders,
  getCacheOptions: h.getCacheOptions,
}))

import { MANUAL_PROVIDER_ID, offeredAtCheckout, STRIPE_CARD_PROVIDER_ID } from "@/lib/constants/payment-providers"
import { listCartPaymentMethods } from "@/lib/data/payment"

const STOREFRONT = path.resolve(__dirname, "../../..")

describe("offeredAtCheckout", () => {
  it("offers the manual provider only to a development build", () => {
    expect(offeredAtCheckout(MANUAL_PROVIDER_ID, "development")).toBe(true)
    expect(offeredAtCheckout(MANUAL_PROVIDER_ID, "production")).toBe(false)
    expect(offeredAtCheckout(MANUAL_PROVIDER_ID, "test")).toBe(false)
    expect(offeredAtCheckout(MANUAL_PROVIDER_ID, undefined)).toBe(false)
  })

  it("offers the card everywhere, and nothing without an id", () => {
    for (const env of ["development", "production", "test", undefined]) {
      expect(offeredAtCheckout(STRIPE_CARD_PROVIDER_ID, env)).toBe(true)
      expect(offeredAtCheckout(undefined, env)).toBe(false)
      expect(offeredAtCheckout("", env)).toBe(false)
    }
  })
})

describe("listCartPaymentMethods", () => {
  beforeEach(() => {
    h.fetch.mockReset()
    // As a region seeded with both answers: the backend sorts nothing.
    h.fetch.mockResolvedValue({
      payment_providers: [{ id: MANUAL_PROVIDER_ID }, { id: STRIPE_CARD_PROVIDER_ID }],
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("drops the manual provider from what a production build lists", async () => {
    vi.stubEnv("NODE_ENV", "production")

    await expect(listCartPaymentMethods("reg_us")).resolves.toEqual([{ id: STRIPE_CARD_PROVIDER_ID }])
    expect(h.fetch).toHaveBeenCalledWith(
      "/store/payment-providers",
      expect.objectContaining({ query: { region_id: "reg_us" } })
    )
  })

  it("keeps it, after the card, for a development build", async () => {
    vi.stubEnv("NODE_ENV", "development")

    await expect(listCartPaymentMethods("reg_us")).resolves.toEqual([
      { id: STRIPE_CARD_PROVIDER_ID },
      { id: MANUAL_PROVIDER_ID },
    ])
  })
})

describe("a production build has NODE_ENV \"production\" in its code", () => {
  it("is built by the storefront's Docker build under ENV NODE_ENV=production", () => {
    const dockerfile = readFileSync(path.join(STOREFRONT, "Dockerfile"), "utf8")
    const build = dockerfile.slice(dockerfile.indexOf("AS build"), dockerfile.indexOf("AS runtime"))

    expect(build).toMatch(/^RUN node_modules\/\.bin\/next build$/m)
    const env = build.search(/^ENV NODE_ENV=production$/m)
    expect(env).toBeGreaterThan(-1)
    expect(env).toBeLessThan(build.search(/^RUN node_modules\/\.bin\/next build$/m))
    // No build argument or later ENV that could put another value there.
    expect(build).not.toMatch(/^ARG NODE_ENV/m)
    expect(build.match(/^ENV NODE_ENV=/gm)).toHaveLength(1)
  })

  it("does not switch on Next's development build", () => {
    const config = readFileSync(path.join(STOREFRONT, "next.config.ts"), "utf8")
    expect(config).not.toMatch(/allowDevelopmentBuild/)
  })

  it("relies on Next writing \"production\" into the bundle at next build unless the development build is on", () => {
    // Read from the installed Next, so an upgrade that changes the rule fails
    // here and is looked at, not at a buyer's checkout.
    const require = createRequire(path.join(STOREFRONT, "package.json"))
    const nextDir = path.dirname(require.resolve("next/package.json"))
    const defineEnv = readFileSync(path.join(nextDir, "dist/build/define-env.js"), "utf8")

    expect(defineEnv).toMatch(
      /'process\.env\.NODE_ENV':\s*dev\s*\|\|\s*config\.experimental\.allowDevelopmentBuild\s*\?\s*'development'\s*:\s*'production'/
    )
  })
})
