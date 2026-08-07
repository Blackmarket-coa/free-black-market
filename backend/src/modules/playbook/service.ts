import { MedusaService } from "@medusajs/framework/utils"
import { Playbook, PlaybookAssignment, PlaybookTransition } from "./models"
import { PLAYBOOK_RECIPES, PLAYBOOK_IDS, getRecipe } from "./recipes"
import type { PlaybookId, PlaybookRecipe } from "./recipes"
import { recommendPlaybook } from "./recommend"
import type { PickerAnswers, Recommendation } from "./recommend"
import {
  resolveProgressionsFrom,
  findEdge,
  diffPlaybooks,
} from "./progressions"
import type {
  ResolvedProgression,
  ProgressionEdge,
  ProgressionDiff,
} from "./progressions"

class PlaybookService extends MedusaService({
  Playbook,
  PlaybookAssignment,
  PlaybookTransition,
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

  /**
   * Declared progressions leaving a playbook, with the gains/losses diff
   * already computed. Pure; no DB access.
   */
  listProgressionsFrom(recipe_id: PlaybookId): ResolvedProgression[] {
    return resolveProgressionsFrom(recipe_id)
  }

  /** The declared edge for a move, or undefined when it isn't one. */
  findProgression(
    from: PlaybookId,
    to: PlaybookId
  ): ProgressionEdge | undefined {
    return findEdge(from, to)
  }

  /** What a move gains and costs, derived from the two recipes. */
  diffPlaybooks(from: PlaybookId, to: PlaybookId): ProgressionDiff {
    return diffPlaybooks(from, to)
  }

  /** A seller's playbook history, newest first. */
  async listTransitionsForSeller(seller_id: string) {
    const rows = await this.listPlaybookTransitions({ seller_id })
    return rows.sort(
      (a: any, b: any) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    )
  }
}

export default PlaybookService
