import { Module } from "@medusajs/framework/utils"
import IrsExemptOrgModuleService from "./service"
import { IRS_EXEMPT_ORG_MODULE } from "./module-key"

export { IRS_EXEMPT_ORG_MODULE }
export * from "./models"
export * from "./sources"
export * from "./lookup"
export { normalizeEin, formatEin } from "./ein"

/**
 * IRS exempt-organisation bulk files, ingested weekly behind
 * `FF_NONPROFIT_PARITY_V1`, so FBM can answer "what did the IRS file dated X
 * say about EIN Y" with one of four states and the file's date.
 *
 * This module moves no money. It reads three public IRS files and stores
 * org-level facts about third parties; nothing here touches a cart, an order,
 * a payout or the ledger (docs/POSTURE_A_COMPLIANCE.md is unaffected).
 */
export default Module(IRS_EXEMPT_ORG_MODULE, {
  service: IrsExemptOrgModuleService,
})
