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
