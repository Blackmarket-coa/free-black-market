import { MedusaService } from "@medusajs/framework/utils"
import { Playbook, PlaybookAssignment } from "./models"
import { PLAYBOOK_RECIPES, PLAYBOOK_IDS, getRecipe } from "./recipes"
import type { PlaybookId, PlaybookRecipe } from "./recipes"
import { recommendPlaybook } from "./recommend"
import type { PickerAnswers, Recommendation } from "./recommend"

class PlaybookService extends MedusaService({
  Playbook,
  PlaybookAssignment,
}) {
  /**
   * Look up the in-code recipe for an id. Throws if unknown.
   * Use this instead of reading the `playbook` table when you only need
   * the recipe shape (commission rate, allowed listing types, defaults).
   */
  getRecipe(id: PlaybookId): PlaybookRecipe {
    return getRecipe(id)
  }

  /** All recipe ids in canonical order. */
  listRecipeIds(): PlaybookId[] {
    return PLAYBOOK_IDS.slice()
  }

  /** All recipes as an array (canonical order). */
  listRecipes(): PlaybookRecipe[] {
    return PLAYBOOK_IDS.map((id) => PLAYBOOK_RECIPES[id])
  }

  /**
   * Run the 3-question picker decision function.
   * Pure; no DB access. The caller is expected to persist the result via
   * `assignPlaybook(seller_id, recommendation.playbook, answers)`.
   */
  recommend(answers: PickerAnswers): Recommendation {
    return recommendPlaybook(answers)
  }

  /**
   * Whether a given listing-type is allowed for a recipe.
   * Used by the `assertListingTypeAllowedForPlaybook` workflow step.
   */
  isListingTypeAllowed(recipe_id: PlaybookId, listing_type_id: string): boolean {
    const recipe = getRecipe(recipe_id)
    return (recipe.allowed_listing_types as string[]).includes(listing_type_id)
  }
}

export default PlaybookService
