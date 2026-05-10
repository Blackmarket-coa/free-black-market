import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"

import { PLAYBOOK_MODULE } from "../../modules/playbook"
import { LISTING_TYPE_MODULE } from "../../modules/listing-type"
import type { PlaybookId, ListingTypeId } from "../../modules/playbook"

/**
 * Hook on `createProductsWorkflow.hooks.productsCreated` enforcing
 * playbook × listing-type compatibility per `docs/PLAYBOOK_SYSTEM.md`.
 *
 * The Medusa v2 `createProductsWorkflow` only exposes a post-create hook
 * (no pre-validate). We throw here on incompatible combinations and let
 * the workflow's compensation step roll back the create. Pre-validation
 * at the vendor API layer remains the preferred path (cheaper); this
 * hook is the backstop.
 *
 * A product's listing-type is supplied via `additional_data`:
 *   - `additional_data.listing_type_id` (preferred), or
 *   - `additional_data.fbm_listing_type` (back-compat alias).
 *
 * When the field is absent the product defaults to `physical_product`
 * (the universal default). When the seller has no playbook assignment
 * (e.g. legacy seller pre-picker), validation is skipped — the vendor-
 * panel migration flow re-prompts these sellers.
 */
createProductsWorkflow.hooks.productsCreated(
  async ({ additional_data }, { container }) => {
    const additional = (additional_data ?? {}) as Record<string, unknown>

    const rawListingType =
      (additional.listing_type_id as string | undefined) ??
      (additional.fbm_listing_type as string | undefined)

    const listingTypeId = (rawListingType ?? "physical_product") as ListingTypeId

    const sellerId =
      (additional.seller_id as string | undefined) ??
      (additional.fbm_seller_id as string | undefined)
    if (!sellerId) {
      return
    }

    const playbookService: any = container.resolve(PLAYBOOK_MODULE)
    const listingTypeService: any = container.resolve(LISTING_TYPE_MODULE)

    const [assignment] = await playbookService.listPlaybookAssignments({
      seller_id: sellerId,
    })
    if (!assignment) {
      // Legacy seller — skip; vendor-panel migration flow re-prompts.
      return
    }

    const recipeId = assignment.recipe_id as PlaybookId
    if (!playbookService.isListingTypeAllowed(recipeId, listingTypeId)) {
      const recipe = playbookService.getRecipe(recipeId)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Listing type "${listingTypeId}" is not allowed on the ${recipe.display_name} playbook. ` +
          `Allowed types: ${(recipe.allowed_listing_types as string[]).join(", ")}. ` +
          `Switch playbooks (vendor settings → playbook) if your offering shape no longer fits.`
      )
    }

    // Surface a friendly error for an unknown catalog id, in case
    // malformed `additional_data` slipped past the form.
    try {
      listingTypeService.getDefinition(listingTypeId)
    } catch {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown listing-type "${listingTypeId}". Pick one from the v1 catalog (see docs/LISTING_TYPES.md).`
      )
    }
  }
)
