/**
 * `seller_metadata.enabled_extensions` key vocabulary.
 *
 * That single `jsonb` column carries TWO namespaces:
 *
 *   1. **UI feature keys** — the 14 `hasX` dashboard modules the vendor-panel
 *      resolves into its `VendorFeatures` object.
 *   2. **Plugin slugs** — written by `POST /v1/seller/plugins/:slug/install`.
 *
 * The vendor-panel's `buildFeaturesFromExtensions` starts from an all-false
 * feature object and flips on only keys it recognises, so an array holding
 * *only* plugin slugs resolves to "every feature off" rather than "defaults".
 * That is why the two namespaces have to stay separable, and why anything
 * writing this column must never turn a `null` (meaning "use my archetype
 * defaults") into a slug-only array.
 *
 * Splitting the column into two is the right long-term fix; it is deliberately
 * out of scope here because six code paths write it today. This module is the
 * shared vocabulary that keeps the two sets distinguishable until then.
 */

// Imported from the recipe/feature layer directly rather than the playbook
// module index: the index calls `Module()` and pulls in the service, which a
// pure vocabulary helper has no business dragging in (and which would make
// this module un-unit-testable without a container).
import { playbookForVendorType, unionFeatureKeys } from "../modules/playbook/features"
import type {
  PlaybookFeatureDefaults,
  PlaybookId,
} from "../modules/playbook/recipes/types"

/**
 * The canonical 14 dashboard feature keys.
 *
 * `satisfies` pins this to `PlaybookFeatureDefaults`, so a key that is renamed
 * or removed there fails the build here rather than silently becoming an
 * unrecognised string that reads as "plugin slug".
 */
export const UI_FEATURE_KEYS = [
  "hasProducts",
  "hasInventory",
  "hasSeasons",
  "hasVolunteers",
  "hasMenu",
  "hasDeliveryZones",
  "hasDonations",
  "hasSubscriptions",
  "hasSupport",
  "hasHarvests",
  "hasPlots",
  "hasRequests",
  "hasFarm",
  "hasShows",
] as const satisfies readonly (keyof PlaybookFeatureDefaults)[]

export type UiFeatureKey = (typeof UI_FEATURE_KEYS)[number]

/**
 * Compile-time guard for the other direction: every key in
 * `PlaybookFeatureDefaults` must appear above. Without this, *adding* a key to
 * the recipe type would leave it absent here and it would be misread as a
 * plugin slug at runtime. If this line errors, add the missing key to
 * `UI_FEATURE_KEYS`.
 */
type MissingUiFeatureKeys = Exclude<keyof PlaybookFeatureDefaults, UiFeatureKey>
const _assertNoMissingUiFeatureKeys: MissingUiFeatureKeys extends never
  ? true
  : never = true
void _assertNoMissingUiFeatureKeys

const UI_FEATURE_KEY_SET: ReadonlySet<string> = new Set(UI_FEATURE_KEYS)

/** Is this a known dashboard feature key? */
export function isUiFeatureKey(key: unknown): key is UiFeatureKey {
  return typeof key === "string" && UI_FEATURE_KEY_SET.has(key)
}

/**
 * Is this entry a plugin slug rather than a dashboard feature key?
 *
 * Defined as the complement of the feature-key set: the plugin registry owns
 * an open slug namespace, so "not a known feature key" is the only check that
 * stays correct as plugins are added.
 */
export function isPluginSlugKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && !UI_FEATURE_KEY_SET.has(key)
}

/** Partition a stored `enabled_extensions` array into its two namespaces. */
export function partitionExtensionKeys(
  stored: unknown
): { featureKeys: UiFeatureKey[]; pluginSlugs: string[] } {
  if (!Array.isArray(stored)) {
    return { featureKeys: [], pluginSlugs: [] }
  }
  const featureKeys: UiFeatureKey[] = []
  const pluginSlugs: string[] = []
  for (const entry of stored) {
    if (isUiFeatureKey(entry)) {
      featureKeys.push(entry)
    } else if (isPluginSlugKey(entry)) {
      pluginSlugs.push(entry)
    }
  }
  return { featureKeys, pluginSlugs }
}

/** Only the plugin-slug entries of a stored `enabled_extensions` value. */
export function pluginSlugsFrom(stored: unknown): string[] {
  return partitionExtensionKeys(stored).pluginSlugs
}

/**
 * The dashboard feature keys a seller gets by default, derived from their
 * archetype via the playbook recipes.
 *
 * This is the value a writer must fall back to when `enabled_extensions` is
 * `null` and it needs a concrete array — writing `[]` instead is what turns
 * "use my defaults" into "everything off".
 */
export function defaultFeatureKeysForVendorType(
  vendorType: string | null | undefined
): UiFeatureKey[] {
  return defaultFeatureKeysForPlaybook(playbookForVendorType(vendorType))
}

/** The dashboard feature keys a given playbook enables by default. */
export function defaultFeatureKeysForPlaybook(
  playbook: PlaybookId
): UiFeatureKey[] {
  return unionFeatureKeys([playbook]).filter(isUiFeatureKey)
}

/**
 * Defaults for a seller, given whatever their `seller_metadata` row holds.
 * Prefers an explicit playbook and falls back to the legacy `vendor_type`.
 */
export function defaultFeatureKeysForSeller(
  meta: { vendor_type?: string | null; playbook?: string | null } | null | undefined
): UiFeatureKey[] {
  const playbook = meta?.playbook
  if (playbook) {
    return defaultFeatureKeysForPlaybook(playbook as PlaybookId)
  }
  return defaultFeatureKeysForVendorType(meta?.vendor_type)
}

/**
 * Validate a submitted `enabled_extensions` array, returning the entries that
 * are neither a known dashboard feature key, nor a slug the seller already
 * holds, nor a slug that resolves in the plugin registry.
 *
 * `resolvePluginSlug` is injected so this stays container-free and unit
 * testable; callers pass a registry lookup. It is only consulted for entries
 * that fail the cheap checks, so the common case makes no calls at all.
 *
 * A non-array input (`null`, meaning "reset to archetype defaults") is valid
 * and yields no unknowns.
 */
export async function findUnknownExtensionKeys(
  submitted: unknown,
  opts: {
    previouslyHeld?: readonly string[]
    resolvePluginSlug: (slug: string) => Promise<boolean>
  }
): Promise<string[]> {
  if (!Array.isArray(submitted)) return []

  const previouslyHeld = new Set(opts.previouslyHeld ?? [])
  const unknown: string[] = []

  for (const key of submitted) {
    if (typeof key !== "string" || !key.length) {
      unknown.push(String(key))
      continue
    }
    if (isUiFeatureKey(key) || previouslyHeld.has(key)) continue

    const exists = await opts.resolvePluginSlug(key).catch(() => false)
    if (!exists) unknown.push(key)
  }

  return unknown
}

/**
 * Resolve the array a writer should persist when it needs to append to
 * `enabled_extensions`.
 *
 * `null`/non-array means "using archetype defaults", so the defaults are
 * materialised rather than dropped. An existing array is returned as-is —
 * including an empty one, which is a deliberate "everything off" choice the
 * vendor made and must not be silently repopulated.
 */
export function materializeExtensionsForAppend(
  stored: unknown,
  meta: { vendor_type?: string | null; playbook?: string | null } | null | undefined
): string[] {
  if (Array.isArray(stored)) {
    return stored.filter((k): k is string => typeof k === "string")
  }
  return [...defaultFeatureKeysForSeller(meta)]
}
