import { Module } from "@medusajs/framework/utils"
import PartnerDirectoryModuleService from "./service"

/**
 * Partner directory — a code-config registry behind a thin module service:
 * no table, no migrations. `catalog.ts` is the source of truth;
 * `GET /store/partners` resolves the service, the quest definitions import
 * `partnerLinks` directly for their gatekeeper links. If it ever needs
 * per-region entries an operator edits without a deploy, seed the catalog
 * into a table the way `opportunity-engine/startup-guides` is; the shape
 * here is the seed and the service methods are the contract.
 */
export const PARTNER_DIRECTORY_MODULE = "partnerDirectory"

export default Module(PARTNER_DIRECTORY_MODULE, {
  service: PartnerDirectoryModuleService,
})

export * from "./types"
export * from "./catalog"
