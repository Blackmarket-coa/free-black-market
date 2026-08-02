/**
 * Feature helpers for multi-role vendors.
 *
 * A vendor picks a primary playbook plus optional extra roles. The set of
 * feature modules they see is the UNION of every selected role's
 * `default_features`. We persist that union to
 * `seller_metadata.enabled_extensions`, which the vendor-panel
 * playbook-provider already honours as an override of the primary
 * playbook's defaults.
 */

import { PLAYBOOK_RECIPES } from "./recipes"
import type { PlaybookId } from "./recipes/types"

/**
 * Fallback map from legacy `vendor_type` → playbook, for callers that only
 * have the legacy archetype (requests predating the resource quiz, and the
 * extension-key defaults in `shared/extension-keys.ts`).
 *
 * This is the canonical backend copy. `shared/seller-approval-service.ts`
 * imports it rather than keeping its own. The vendor-panel mirrors it as
 * LEGACY_VENDOR_TYPE_MAP in playbook-provider/playbook-context.tsx.
 */
export const LEGACY_VENDOR_TYPE_TO_PLAYBOOK: Record<string, PlaybookId> = {
  producer: "cycle",
  garden: "harvest",
  kitchen: "kitchen",
  restaurant: "kitchen",
  maker: "stall",
  mutual_aid: "grove",
  creator: "creator",
  // The archetype-neutral vendor maps to `stall` — the solo-seller recipe
  // (products + inventory + support). Deliberately reuses an existing recipe
  // rather than introducing a 12th playbook: the playbook set is asserted
  // verbatim by storefront tests and seeded into the `playbook` table, so
  // growing it is its own change.
  general: "stall",
}

/** Playbook a legacy `vendor_type` maps to. Unknown types fall back to `stall`. */
export const playbookForVendorType = (
  vendorType: string | null | undefined
): PlaybookId => {
  if (!vendorType) return "stall"
  return LEGACY_VENDOR_TYPE_TO_PLAYBOOK[vendorType] ?? "stall"
}

/**
 * Union of the `default_features` keys that are enabled across all the
 * given roles. Returns the list of enabled feature keys (e.g.
 * ["hasProducts", "hasShows", ...]).
 */
export const unionFeatureKeys = (roles: PlaybookId[]): string[] => {
  const keys = new Set<string>()
  for (const role of roles) {
    const recipe = PLAYBOOK_RECIPES[role]
    if (!recipe) continue
    for (const [key, enabled] of Object.entries(recipe.default_features)) {
      if (enabled) keys.add(key)
    }
  }
  return Array.from(keys)
}
