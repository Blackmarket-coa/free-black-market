/**
 * `shared/extension-keys` — the vocabulary that keeps the two namespaces
 * inside `seller_metadata.enabled_extensions` separable.
 *
 * Pure module, no container: it imports only the playbook recipe/feature
 * layer, which is Medusa-free by design.
 */

import {
  UI_FEATURE_KEYS,
  defaultFeatureKeysForPlaybook,
  defaultFeatureKeysForSeller,
  defaultFeatureKeysForVendorType,
  findUnknownExtensionKeys,
  isPluginSlugKey,
  isUiFeatureKey,
  materializeExtensionsForAppend,
  partitionExtensionKeys,
  pluginSlugsFrom,
} from "../extension-keys"
import { PLAYBOOK_RECIPES } from "../../modules/playbook/recipes"

describe("UI_FEATURE_KEYS", () => {
  it("is exactly the 14 canonical dashboard keys", () => {
    expect(UI_FEATURE_KEYS).toHaveLength(14)
    expect(new Set(UI_FEATURE_KEYS).size).toBe(14)
  })

  it("covers every key any playbook recipe defaults — the drift guard", () => {
    // If a recipe gains a feature key that is missing here, that key would be
    // misread as a plugin slug at runtime. The `satisfies` clause in the module
    // catches the type-level half; this catches the data-level half.
    const keysUsedByRecipes = new Set<string>()
    for (const recipe of Object.values(PLAYBOOK_RECIPES)) {
      for (const key of Object.keys(recipe.default_features)) {
        keysUsedByRecipes.add(key)
      }
    }
    const missing = [...keysUsedByRecipes].filter(
      (k) => !(UI_FEATURE_KEYS as readonly string[]).includes(k)
    )
    expect(missing).toEqual([])
  })
})

describe("namespace classification", () => {
  it("recognises dashboard feature keys", () => {
    expect(isUiFeatureKey("hasProducts")).toBe(true)
    expect(isUiFeatureKey("hasShows")).toBe(true)
    expect(isUiFeatureKey("sales-analytics")).toBe(false)
    expect(isUiFeatureKey(undefined)).toBe(false)
  })

  it("treats anything that is not a feature key as a plugin slug", () => {
    expect(isPluginSlugKey("sales-analytics")).toBe(true)
    expect(isPluginSlugKey("hasProducts")).toBe(false)
    expect(isPluginSlugKey("")).toBe(false)
    expect(isPluginSlugKey(42)).toBe(false)
  })

  it("partitions a mixed array into its two namespaces", () => {
    const { featureKeys, pluginSlugs } = partitionExtensionKeys([
      "hasProducts",
      "sales-analytics",
      "hasMenu",
      "storefront-themes",
      "",
      null,
    ])
    expect(featureKeys).toEqual(["hasProducts", "hasMenu"])
    expect(pluginSlugs).toEqual(["sales-analytics", "storefront-themes"])
  })

  it("returns empty partitions for a null column", () => {
    expect(partitionExtensionKeys(null)).toEqual({
      featureKeys: [],
      pluginSlugs: [],
    })
    expect(pluginSlugsFrom(null)).toEqual([])
  })
})

describe("archetype defaults", () => {
  it("derives a playbook's defaults from its recipe", () => {
    // `stall` defaults hasProducts + hasInventory + hasSupport.
    expect(new Set(defaultFeatureKeysForPlaybook("stall"))).toEqual(
      new Set(["hasProducts", "hasInventory", "hasSupport"])
    )
  })

  it("maps a legacy vendor_type through to its playbook's defaults", () => {
    expect(defaultFeatureKeysForVendorType("maker")).toEqual(
      defaultFeatureKeysForPlaybook("stall")
    )
    expect(defaultFeatureKeysForVendorType("garden")).toEqual(
      defaultFeatureKeysForPlaybook("harvest")
    )
  })

  it("falls back to the stall defaults for unknown or absent archetypes", () => {
    const stall = defaultFeatureKeysForPlaybook("stall")
    expect(defaultFeatureKeysForVendorType(undefined)).toEqual(stall)
    expect(defaultFeatureKeysForVendorType("not-a-real-type")).toEqual(stall)
  })

  it("prefers an explicit playbook over the legacy vendor_type", () => {
    const meta = { vendor_type: "maker", playbook: "harvest" }
    expect(defaultFeatureKeysForSeller(meta)).toEqual(
      defaultFeatureKeysForPlaybook("harvest")
    )
  })

  it("never returns a key outside the canonical set", () => {
    for (const playbook of Object.keys(PLAYBOOK_RECIPES)) {
      for (const key of defaultFeatureKeysForPlaybook(playbook as never)) {
        expect(UI_FEATURE_KEYS).toContain(key)
      }
    }
  })
})

describe("materializeExtensionsForAppend", () => {
  const meta = { vendor_type: "maker" }

  it("materialises archetype defaults when the column is null", () => {
    // This is the lockout fix: appending to `[]` would persist a slug-only
    // array, which the panel resolves as "every feature off".
    expect(materializeExtensionsForAppend(null, meta)).toEqual(
      defaultFeatureKeysForPlaybook("stall")
    )
    expect(materializeExtensionsForAppend(undefined, meta)).not.toEqual([])
  })

  it("preserves an existing array untouched", () => {
    expect(materializeExtensionsForAppend(["hasMenu", "some-plugin"], meta)).toEqual([
      "hasMenu",
      "some-plugin",
    ])
  })

  it("respects a deliberate empty selection", () => {
    // `[]` is the vendor explicitly turning everything off — not the same as
    // `null`, and it must not be silently repopulated with defaults.
    expect(materializeExtensionsForAppend([], meta)).toEqual([])
  })
})

describe("findUnknownExtensionKeys", () => {
  const never = async () => false
  const always = async () => true

  it("accepts a null reset without consulting the registry", async () => {
    const resolvePluginSlug = jest.fn(never)
    expect(
      await findUnknownExtensionKeys(null, { resolvePluginSlug })
    ).toEqual([])
    expect(resolvePluginSlug).not.toHaveBeenCalled()
  })

  it("accepts known feature keys with no registry calls", async () => {
    const resolvePluginSlug = jest.fn(never)
    expect(
      await findUnknownExtensionKeys(["hasProducts", "hasMenu"], {
        resolvePluginSlug,
      })
    ).toEqual([])
    expect(resolvePluginSlug).not.toHaveBeenCalled()
  })

  it("rejects arbitrary invented strings", async () => {
    expect(
      await findUnknownExtensionKeys(["hasProducts", "hasEverything"], {
        resolvePluginSlug: never,
      })
    ).toEqual(["hasEverything"])
  })

  it("accepts a slug that resolves in the registry", async () => {
    expect(
      await findUnknownExtensionKeys(["sales-analytics"], {
        resolvePluginSlug: always,
      })
    ).toEqual([])
  })

  it("accepts a slug the seller already holds even if it no longer resolves", async () => {
    // A deprecated plugin must not make the seller's array unsaveable.
    expect(
      await findUnknownExtensionKeys(["retired-plugin"], {
        previouslyHeld: ["retired-plugin"],
        resolvePluginSlug: never,
      })
    ).toEqual([])
  })

  it("rejects non-string and empty entries", async () => {
    const unknown = await findUnknownExtensionKeys(
      ["hasProducts", "", 7 as unknown as string],
      { resolvePluginSlug: never }
    )
    expect(unknown).toHaveLength(2)
  })

  it("treats a registry lookup failure as unknown rather than throwing", async () => {
    expect(
      await findUnknownExtensionKeys(["boom"], {
        resolvePluginSlug: async () => {
          throw new Error("registry down")
        },
      })
    ).toEqual(["boom"])
  })
})
