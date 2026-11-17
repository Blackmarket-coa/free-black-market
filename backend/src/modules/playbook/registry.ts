import { PLAYBOOK_IDS, PLAYBOOK_RECIPES } from "./recipes"
import type { PlaybookRecipe } from "./recipes/types"

/**
 * The `playbook` row a recipe seeds: the one shape both the boot loader
 * (`loaders/seed-registry.ts`, which inserts missing rows) and
 * `scripts/seed-playbooks.ts` (which also overwrites drift) write, so the two
 * cannot disagree about what a recipe's row holds.
 */
export function playbookRegistryRow(recipe: PlaybookRecipe) {
  return {
    recipe_id: recipe.id,
    display_name: recipe.display_name,
    social_form: recipe.social_form,
    storefront_blurb_default: recipe.storefront_blurb_default,
    commission_rate: recipe.commission_rate,
    allow_sliding_scale: recipe.allow_sliding_scale,
    allow_credits_payout: String(recipe.allow_credits_payout),
    member_model: recipe.member_model,
    allowed_listing_types: recipe.allowed_listing_types,
    default_features: recipe.default_features,
    is_active: true,
  }
}

export type PlaybookRegistryRow = ReturnType<typeof playbookRegistryRow>

/** Every recipe's row, in canonical order. */
export const playbookRegistryRows = (): PlaybookRegistryRow[] =>
  PLAYBOOK_IDS.map((id) => playbookRegistryRow(PLAYBOOK_RECIPES[id]))
