import {
  VENDOR_ADDON_CATALOG,
  VENDOR_ADDON_KEY_SET,
  addonCoveredByPlan,
  addonExpiryFrom,
  addonOfferedForPurchase,
  addonUndercutsPlan,
  getAddonDefinition,
  listPurchasableAddons,
  universalKeysGrantedByAddon,
} from "../addons"
import {
  UNIVERSAL_FEATURE_KEYS,
  VENDOR_PLAN_CATALOG,
  featureKeysForPlan,
} from "../catalog"

describe("add-on catalog", () => {
  it("has unique codes", () => {
    const codes = VENDOR_ADDON_CATALOG.map((a) => a.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("grants only real plan feature keys", () => {
    // A typo'd key would grant nothing and gate nothing — a pack that charges
    // money for a feature that never unlocks.
    for (const addon of VENDOR_ADDON_CATALOG) {
      expect(addon.feature_keys.length).toBeGreaterThan(0)
      for (const key of addon.feature_keys) {
        expect(VENDOR_ADDON_KEY_SET.has(key)).toBe(true)
      }
    }
  })

  it("prices every pack at a positive amount with a positive window", () => {
    for (const addon of VENDOR_ADDON_CATALOG) {
      expect(addon.price_amount).toBeGreaterThan(0)
      expect(addon.duration_days).toBeGreaterThan(0)
      expect(addon.currency_code).toBe("usd")
    }
  })

  it("never lets a pack undercut a plan whose keys it covers", () => {
    // The pricing rule that keeps plans rational: a pack granting a superset
    // of a plan's keys for less would turn add-ons into an accidental
    // discount ladder. embed_pack vs starter is the live case this guards.
    for (const addon of VENDOR_ADDON_CATALOG) {
      expect(addonUndercutsPlan(addon)).toBeNull()
    }
  })

  it("would catch a pack that did undercut a covered plan", () => {
    // The guard itself has to be tested, or the invariant above is a
    // tautology. embed_pack grants everything starter sells; price it below
    // starter.
    const starter = VENDOR_PLAN_CATALOG.find((p) => p.code === "starter")!
    const embed = VENDOR_ADDON_CATALOG.find((a) => a.code === "embed_pack")!
    const cheat = { ...embed, price_amount: starter.price_amount - 100 }

    // starter also carries the universal keys, which no pack may grant. So
    // the pack's keys are NOT a superset of starter's full list, and a guard
    // that compared the full list would let this cheat through.
    expect(UNIVERSAL_FEATURE_KEYS.length).toBeGreaterThan(0)
    for (const key of UNIVERSAL_FEATURE_KEYS) {
      expect(starter.feature_keys).toContain(key)
      expect(cheat.feature_keys).not.toContain(key)
    }

    expect(addonUndercutsPlan(cheat)).toBe("starter")
    // At the plan's own price, or above it, the pack undercuts nothing.
    expect(
      addonUndercutsPlan({ ...embed, price_amount: starter.price_amount })
    ).toBeNull()
    expect(addonUndercutsPlan(embed)).toBeNull()
  })

  it("judges an undercut on what a plan sells, for every paid public plan", () => {
    // A made-up pack granting exactly a plan's non-universal keys for one
    // cent less undercuts that plan (or a cheaper one whose sold keys it also
    // covers). Runs over starter, pro, scale and all_access.
    const paid = VENDOR_PLAN_CATALOG.filter(
      (p) => p.is_public && p.is_active && p.price_amount > 0
    )
    expect(paid.length).toBeGreaterThan(0)
    for (const plan of paid) {
      const cheat = {
        ...VENDOR_ADDON_CATALOG[0],
        code: `cheat_${plan.code}`,
        price_amount: plan.price_amount - 1,
        feature_keys: plan.feature_keys.filter(
          (k) => !UNIVERSAL_FEATURE_KEYS.includes(k)
        ),
      }
      expect(universalKeysGrantedByAddon(cheat)).toEqual([])
      expect(addonUndercutsPlan(cheat)).not.toBeNull()
    }
  })

  it("never grants a key every plan already carries", () => {
    // A pack listing a universal key charges for what its buyer already has
    // on any plan, `free` included.
    for (const addon of VENDOR_ADDON_CATALOG) {
      expect(universalKeysGrantedByAddon(addon)).toEqual([])
      for (const key of UNIVERSAL_FEATURE_KEYS) {
        expect(addon.feature_keys).not.toContain(key)
      }
      // So every key a pack grants is one the free plan lacks.
      for (const key of addon.feature_keys) {
        expect(featureKeysForPlan("free")).not.toContain(key)
      }
    }
  })

  it("would catch a pack that did grant a universal key", () => {
    const grower = getAddonDefinition("grower_pack")!
    const cheat = {
      ...grower,
      feature_keys: [...grower.feature_keys, ...UNIVERSAL_FEATURE_KEYS],
    }
    expect(universalKeysGrantedByAddon(cheat)).toEqual([...UNIVERSAL_FEATURE_KEYS])
  })

  it("sells Grower Tools as nursery management, without the production ledger", () => {
    // PL-1: the pack used to grant `vendor.production_ledger` too. Its price
    // and its 30-day term are deliberately not asserted here: PL-1 left both
    // as they were and confirms neither (the ownership migration in
    // docs/FBM_MONETIZATION_PLAN.md decides them).
    const grower = getAddonDefinition("grower_pack")!
    expect(grower.feature_keys).toEqual(["vendor.nursery"])
    expect(grower.is_active).toBe(true)
    // The copy says what the pack holds and where the ledger went, and does
    // not offer the ledger as part of the pack.
    expect(grower.description).toMatch(/^Nursery management/)
    expect(grower.description).toMatch(
      /production ledger and batch costing now come with every plan/
    )
  })

  it("resolves codes and rejects unknowns", () => {
    expect(getAddonDefinition("quest_pack")?.display_name).toBe(
      "Readiness Quests"
    )
    expect(getAddonDefinition("mystery_pack")).toBeNull()
    expect(getAddonDefinition(null)).toBeNull()
  })

  it("lists active packs in display order", () => {
    const listed = listPurchasableAddons()
    expect(listed.length).toBeGreaterThan(0)
    for (let i = 1; i < listed.length; i++) {
      expect(listed[i].display_order).toBeGreaterThanOrEqual(
        listed[i - 1].display_order
      )
    }
  })
})

describe("add-ons under the all-access plan (Black Mask F8, OI-9)", () => {
  it("counts every pack as covered by all_access and none by free", () => {
    for (const addon of VENDOR_ADDON_CATALOG) {
      expect(addonCoveredByPlan(addon, "all_access")).toBe(true)
      expect(addonCoveredByPlan(addon, "free")).toBe(false)
    }
  })

  it("covers a pack only when the plan holds every one of its keys", () => {
    // starter carries embed + vault (all of embed_pack's keys) and nothing
    // from commerce_pack.
    expect(addonCoveredByPlan(getAddonDefinition("embed_pack")!, "starter")).toBe(true)
    expect(addonCoveredByPlan(getAddonDefinition("commerce_pack")!, "starter")).toBe(false)
    // An unknown plan grants nothing, so it covers nothing (fail closed).
    expect(addonCoveredByPlan(getAddonDefinition("embed_pack")!, "nope")).toBe(false)
  })

  it("offers every active pack to every plan while the flag is off", () => {
    for (const plan of ["free", "starter", "scale", "all_access", "internal"]) {
      expect(
        VENDOR_ADDON_CATALOG.filter((a) => addonOfferedForPurchase(a, plan, false))
      ).toEqual(VENDOR_ADDON_CATALOG.filter((a) => a.is_active))
    }
  })

  it("keeps every pack purchasable for a free vendor with the flag on", () => {
    expect(
      VENDOR_ADDON_CATALOG.filter((a) => addonOfferedForPurchase(a, "free", true))
    ).toEqual(VENDOR_ADDON_CATALOG.filter((a) => a.is_active))
  })

  it("offers an all_access vendor nothing to buy with the flag on", () => {
    // They would pay for keys they already hold.
    expect(
      VENDOR_ADDON_CATALOG.filter((a) =>
        addonOfferedForPurchase(a, "all_access", true)
      )
    ).toEqual([])
  })

  it("hides packs for all_access only — any other plan is offered every pack", () => {
    // OI-9 scopes hiding to all_access. starter covers embed_pack, but a
    // starter vendor (an operator-assigned retired tier) still sees it.
    const active = VENDOR_ADDON_CATALOG.filter((a) => a.is_active)
    for (const plan of ["free", "starter", "pro", "scale", "internal"]) {
      expect(
        VENDOR_ADDON_CATALOG.filter((a) => addonOfferedForPurchase(a, plan, true))
      ).toEqual(active)
    }
  })

  it("offers packs again to an all_access vendor with a move off the plan scheduled", () => {
    // A cancellation (pending free) or a pending downgrade: they may buy a
    // pack to keep past the plan's end.
    const active = VENDOR_ADDON_CATALOG.filter((a) => a.is_active)
    for (const pending of ["free", "starter"]) {
      expect(
        VENDOR_ADDON_CATALOG.filter((a) =>
          addonOfferedForPurchase(a, "all_access", true, pending)
        )
      ).toEqual(active)
    }
    // Nothing pending (including while trialing): still nothing to buy.
    expect(
      VENDOR_ADDON_CATALOG.filter((a) =>
        addonOfferedForPurchase(a, "all_access", true, null)
      )
    ).toEqual([])
  })
})

describe("addonExpiryFrom", () => {
  const now = new Date("2026-08-01T00:00:00.000Z")

  it("starts a fresh window from now", () => {
    expect(addonExpiryFrom(30, now, null)).toEqual(
      new Date("2026-08-31T00:00:00.000Z")
    )
  })

  it("extends an open window from its end, not from now", () => {
    // A second month bought with a week left yields five weeks, not four.
    const openUntil = new Date("2026-08-08T00:00:00.000Z")
    expect(addonExpiryFrom(30, now, openUntil)).toEqual(
      new Date("2026-09-07T00:00:00.000Z")
    )
  })

  it("ignores a window that already closed", () => {
    const lapsed = new Date("2026-07-01T00:00:00.000Z")
    expect(addonExpiryFrom(30, now, lapsed)).toEqual(
      new Date("2026-08-31T00:00:00.000Z")
    )
  })

  it("treats an unparseable expiry as no window", () => {
    expect(addonExpiryFrom(30, now, "not-a-date")).toEqual(
      new Date("2026-08-31T00:00:00.000Z")
    )
  })
})
