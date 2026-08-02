import { describe, expect, it } from "vitest"

import { getVendorNavigationForTest } from "./use-vendor-navigation"
import { getFeaturesByType } from "../../providers/vendor-type-provider"

/**
 * Plan-driven navigation visibility.
 *
 * This is presentation only — `requirePlanFeature` on the backend is the
 * enforcement, and these paid surfaces 402 regardless of what the nav shows.
 * What matters here is that a vendor is not offered a surface their plan does
 * not include, and — more importantly — is never *denied* one they do hold.
 */

const features = getFeaturesByType("general")

const navLabels = (planFeatureKeys?: string[], planLoaded = true) => {
  const { coreRoutes, extensionRoutes } = getVendorNavigationForTest({
    vendorType: "general",
    features,
    planFeatureKeys,
    planLoaded,
  })
  return [...coreRoutes, ...extensionRoutes].map((r) => r.label)
}

describe("plan-gated navigation", () => {
  it("hides a paid surface the plan does not include", () => {
    expect(navLabels([])).not.toContain("Quests")
  })

  it("shows a paid surface the plan includes", () => {
    const labels = navLabels(["vendor.quests"])
    expect(labels).toContain("Quests")
  })

  it("shows only the surfaces the plan actually grants", () => {
    const labels = navLabels(["vendor.document_vault"])
    expect(labels).toContain("Document Vault")
    expect(labels).not.toContain("Quests")
  })

  it("leaves ungated surfaces alone", () => {
    // Core commerce nav must never depend on a plan.
    const gated = navLabels([])
    const ungated = navLabels(["vendor.quests", "vendor.document_vault"])
    for (const label of ["Orders", "Products"]) {
      if (ungated.includes(label)) {
        expect(gated).toContain(label)
      }
    }
  })

  describe("optimistic while unresolved", () => {
    it("shows paid surfaces while the plan is still loading", () => {
      // Hiding a surface a vendor is entitled to on every page load is worse
      // than briefly showing one they are not — the backend 402s that anyway.
      expect(navLabels(undefined, false)).toContain("Quests")
    })

    it("shows paid surfaces when the plan request failed", () => {
      // `planLoaded: false` is how the hook reports an errored request, so a
      // transient backend blip must not collapse the nav to the free tier.
      expect(navLabels([], false)).toContain("Quests")
    })
  })

  it("treats an empty resolved plan as genuinely empty", () => {
    // Distinct from the unresolved case above: once the plan is known to grant
    // nothing, the surfaces really should be hidden.
    expect(navLabels([], true)).not.toContain("Quests")
  })
})
