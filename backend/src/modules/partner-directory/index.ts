import { Module } from "@medusajs/framework/utils"
import PartnerDirectoryModuleService from "./service"

/**
 * Partner directory — two things behind one module key.
 *
 * 1. The refer-out *catalog* is still code-config: `catalog.ts` is the source
 *    of truth, `GET /store/partners` resolves the service, and the quest
 *    definitions import `partnerLinks` directly for their gatekeeper links.
 *    Its three rules (link out, list only what works, no compensation) and
 *    its shape test are unchanged.
 * 2. `partner_org` (`models/partner-org.ts`) is a table: pilot-partner
 *    records that carry what the catalog's rules forbid — an EIN,
 *    ingest-written IRS verification, a fiscal-host pair and a Stripe Connect
 *    destination — default-unpublished, behind FF_NONPROFIT_PARITY_V1.
 *    docs/BMC_SURVIVAL_PROGRAMS.md Phase 1 item 1.
 */
export const PARTNER_DIRECTORY_MODULE = "partnerDirectory"

export default Module(PARTNER_DIRECTORY_MODULE, {
  service: PartnerDirectoryModuleService,
})

export * from "./types"
export * from "./catalog"
export * from "./org-types"
export * from "./models"
