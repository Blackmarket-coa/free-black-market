import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PLAYBOOK_RECIPES, PLAYBOOK_IDS } from "../modules/playbook/recipes"
import { LISTING_TYPE_CATALOG, LISTING_TYPE_IDS } from "../modules/listing-type/catalog"
import { PLAYBOOK_MODULE } from "../modules/playbook"
import { LISTING_TYPE_MODULE } from "../modules/listing-type"

/**
 * Seed the playbook and listing-type registries from their in-code
 * catalogs. Idempotent: re-running upserts any drift between code and DB.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/seed-playbooks.ts
 *
 * See `docs/PLAYBOOK_SYSTEM.md` and `docs/LISTING_TYPES.md`.
 */
export default async function seedPlaybooks({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const playbookService: any = container.resolve(PLAYBOOK_MODULE)
  const listingTypeService: any = container.resolve(LISTING_TYPE_MODULE)

  logger.info("[seed-playbooks] Starting seed for playbook + listing-type registries")

  // ---------- Listing types ----------
  let listingTypesUpserted = 0
  for (const id of LISTING_TYPE_IDS) {
    const def = LISTING_TYPE_CATALOG[id]
    const [existing] = await listingTypeService.listListingTypes({
      catalog_id: id,
    })
    const payload = {
      catalog_id: def.id,
      display_name: def.display_name,
      description: def.description,
      requires_shipping: def.requires_shipping,
      requires_capacity: def.requires_capacity,
      requires_recurrence: def.requires_recurrence,
      requires_escrow: def.requires_escrow,
      unique_inventory: def.unique_inventory,
      is_active: true,
    }
    if (existing) {
      await listingTypeService.updateListingTypes({
        id: existing.id,
        ...payload,
      })
    } else {
      await listingTypeService.createListingTypes(payload)
    }
    listingTypesUpserted++
  }
  logger.info(`[seed-playbooks] Upserted ${listingTypesUpserted} listing types`)

  // ---------- Playbooks ----------
  let playbooksUpserted = 0
  for (const id of PLAYBOOK_IDS) {
    const recipe = PLAYBOOK_RECIPES[id]
    const [existing] = await playbookService.listPlaybooks({ recipe_id: id })
    const payload = {
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
    if (existing) {
      await playbookService.updatePlaybooks({
        id: existing.id,
        ...payload,
      })
    } else {
      await playbookService.createPlaybooks(payload)
    }
    playbooksUpserted++
  }
  logger.info(`[seed-playbooks] Upserted ${playbooksUpserted} playbooks`)

  logger.info("[seed-playbooks] Done")
}
