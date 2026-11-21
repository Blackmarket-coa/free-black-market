import { Module } from "@medusajs/framework/utils"
import JurisdictionRulesModuleService from "./service"

/**
 * Jurisdiction-rule store (Plates pilot, Phase 2; docs/PLATES_SC_PILOT_PLAN.md).
 *
 * What FBM's archived sources say about selling food made at home in a given
 * state: one rule per row, each carrying the source's own words, the document
 * it came from, and a record of who checked FBM's wording against that
 * document. South Carolina is the first state; every other state reads
 * "not covered".
 *
 * The cottage-food module ships no state-law table and never will hold one:
 * its profile is the seller's own declaration. This module is where sourced
 * rule text lives instead, kept apart so that what a seller declared and what
 * a document says are never the same column.
 *
 * **Rules are information only.** Nothing in this module blocks a sale,
 * touches a cart or a checkout, or returns a verdict about a seller.
 *
 * The registration key is exported here. Import it; never type it.
 */
export const JURISDICTION_RULES_MODULE = "jurisdictionRulesModuleService"

export default Module(JURISDICTION_RULES_MODULE, {
  service: JurisdictionRulesModuleService,
})

export * from "./models"
export * from "./types"
export * from "./us-jurisdictions"
export { coverageStatusOf, requiredKeysNotReviewed, reviewedKeysInForce, inForce } from "./coverage"
export type { RuleVersionState } from "./coverage"
export { canonicalJson, canonicalRuleContent, ruleContentSha256, CONTENT_HASH_SCHEME } from "./content-hash"
export { ruleDraftProblems, isIsoDate } from "./rule-draft"
export type { RuleDraftInput } from "./rule-draft"
export { JurisdictionRuleError, standingOf, sourceProblems } from "./service"
export type {
  CreateDraftVersionResult,
  JurisdictionCoverageRecord,
  JurisdictionRuleErrorReason,
  JurisdictionRuleRecord,
  JurisdictionSourceRecord,
  MarkReviewedInput,
  MarkReviewedResult,
  RegisterSourceInput,
  RuleVersionStanding,
  RuleView,
  RuleViewEntry,
  RuleViewSource,
  WithdrawRuleInput,
} from "./service"
