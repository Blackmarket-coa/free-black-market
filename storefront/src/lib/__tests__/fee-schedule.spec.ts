import { readFileSync } from "fs"
import path from "path"

import { describe, expect, it } from "vitest"

import { FALLBACK_DEFAULT_FEE_PERCENT } from "../constants/fees"

/**
 * The storefront quotes a commission rate. Normally it comes from
 * `/store/fee-schedule`, which reads the billing catalog that actually charges
 * vendors — so it cannot drift. But `getFeeSchedule` falls back to a local
 * constant when the backend is unreachable, and that constant is a hand-copied
 * duplicate of a number the platform is accountable for.
 *
 * An unchecked duplicate is exactly the failure this work exists to correct, so
 * this reads `PLATFORM_DEFAULT_FEE_PERCENT` out of the backend source and fails
 * if the two disagree. Same approach as
 * `packages/bmc-portal-kit/src/tiers.parity.spec.ts`: parsed as text rather
 * than imported, because the backend is a separate workspace with its own
 * Medusa toolchain and pulling it in to read one number would make the
 * storefront's tests depend on the backend building.
 */
describe("fee fallback parity with the backend", () => {
  const catalogSource = readFileSync(
    path.join(
      __dirname,
      "../../../../backend/src/modules/vendor-plan/catalog.ts"
    ),
    "utf8"
  )

  function backendConstant(name: string): number {
    const match = catalogSource.match(
      new RegExp(`export const ${name}\\s*=\\s*([\\d.]+)`)
    )
    if (!match) {
      throw new Error(
        `Could not find ${name} in vendor-plan/catalog.ts. If it was renamed, ` +
          `update this test rather than deleting it — it is the only thing ` +
          `stopping the storefront quoting a rate we do not charge.`
      )
    }
    return Number(match[1])
  }

  it("finds the backend's default rate", () => {
    // Guards the regex: a silent parse failure would make the assertion below
    // compare against NaN and pass nothing useful.
    expect(Number.isFinite(backendConstant("PLATFORM_DEFAULT_FEE_PERCENT"))).toBe(
      true
    )
  })

  it("quotes the same rate the backend charges by default", () => {
    expect(FALLBACK_DEFAULT_FEE_PERCENT).toBe(
      backendConstant("PLATFORM_DEFAULT_FEE_PERCENT")
    )
  })

  it("is the rate the free plan actually carries", () => {
    // The fallback stands in for "a seller with no plan", which is the free
    // tier. If the free plan ever moved off the platform default, the fallback
    // would be quoting a rate nobody is on.
    const freePlan = catalogSource.match(
      /code:\s*"free"[\s\S]{0,600}?platform_fee_percent:\s*([\d.]+)/
    )
    expect(freePlan).not.toBeNull()
    expect(Number(freePlan![1])).toBe(FALLBACK_DEFAULT_FEE_PERCENT)
  })
})
