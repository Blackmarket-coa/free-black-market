import { describe, expect, it } from "vitest"

import { parsePlanDenial } from "./vendor-plan"

/**
 * `fetchQuery` throws an Error carrying `details`. Two different 402s arrive on
 * paid surfaces and need different copy, and a 503 from the same gate must not
 * be mistaken for either.
 */

const denial = (status: number, body: Record<string, unknown> | null) => ({
  details: { status, backendBody: body },
})

describe("parsePlanDenial", () => {
  it("reads a feature denial", () => {
    const parsed = parsePlanDenial(
      denial(402, {
        code: "plan_upgrade_required",
        message: "Your free plan does not include this feature.",
        required_feature: "vendor.pos",
        current_plan: "free",
        upgrade_url: "/settings/billing",
      })
    )

    expect(parsed?.kind).toBe("feature")
    expect(parsed?.requiredFeature).toBe("vendor.pos")
    expect(parsed?.currentPlan).toBe("free")
  })

  it("reads a limit denial with its counts", () => {
    const parsed = parsePlanDenial(
      denial(402, {
        code: "plan_limit_reached",
        message: "Your free plan allows 1 embed keys. Upgrade to add more.",
        limit_key: "embed_keys",
        limit: 1,
        current: 1,
        current_plan: "free",
        upgrade_url: "/settings/billing",
      })
    )

    expect(parsed?.kind).toBe("limit")
    expect(parsed?.limitKey).toBe("embed_keys")
    expect(parsed?.limit).toBe(1)
    expect(parsed?.current).toBe(1)
    // A limit denial has no required feature — the surface IS included.
    expect(parsed?.requiredFeature).toBeNull()
  })

  it("ignores a 503 from the same gate", () => {
    // `plan_check_unavailable` is a transient backend problem. Showing it as
    // "upgrade to continue" would tell a paying vendor something false.
    expect(
      parsePlanDenial(
        denial(503, {
          code: "plan_check_unavailable",
          message: "Unable to verify plan entitlements.",
        })
      )
    ).toBeNull()
  })

  it("ignores an unrelated 402", () => {
    expect(parsePlanDenial(denial(402, { code: "card_declined" }))).toBeNull()
  })

  it("ignores errors with no details at all", () => {
    expect(parsePlanDenial(new Error("network down"))).toBeNull()
    expect(parsePlanDenial(null)).toBeNull()
    expect(parsePlanDenial(undefined)).toBeNull()
  })

  it("falls back to copy that matches the denial kind", () => {
    const limit = parsePlanDenial(
      denial(402, { code: "plan_limit_reached", limit_key: "embed_keys" })
    )
    const feature = parsePlanDenial(denial(402, { code: "plan_upgrade_required" }))

    expect(limit?.message).toContain("Upgrade to add more")
    expect(feature?.message).toContain("does not include this feature")
    expect(limit?.upgradeUrl).toBe("/settings/billing")
  })
})
