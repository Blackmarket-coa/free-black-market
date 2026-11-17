import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PLAYBOOK_MODULE } from "../modules/playbook"
import { playbookRegistryRows } from "../modules/playbook/registry"
import { LISTING_TYPE_MODULE } from "../modules/listing-type"
import { listingTypeRegistryRows } from "../modules/listing-type/registry"

/**
 * Push the playbook and listing-type registries to the in-code catalogs:
 * inserts missing rows AND overwrites every existing row with the code's
 * values, an operator's edits included. Run it deliberately, to roll out a
 * recipe or catalog change to rows that already exist.
 *
 * Missing rows no longer need it: each module's boot loader
 * (`modules/{playbook,listing-type}/loaders/seed-registry.ts`) inserts the
 * rows a registry lacks on every start and changes nothing else. Both write
 * the same row shapes (`modules/{playbook,listing-type}/registry.ts`).
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
  for (const payload of listingTypeRegistryRows()) {
    const [existing] = await listingTypeService.listListingTypes({
      catalog_id: payload.catalog_id,
    })
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
  for (const payload of playbookRegistryRows()) {
    const [existing] = await playbookService.listPlaybooks({
      recipe_id: payload.recipe_id,
    })
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
