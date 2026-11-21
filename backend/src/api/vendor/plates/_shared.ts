import type { MedusaResponse } from "@medusajs/framework/http"
import { NOT_STATED } from "../../../modules/jurisdiction-rules"
import type { RuleView, RuleViewEntry } from "../../../modules/jurisdiction-rules"
import { PHASE0_FEATURE_FLAGS, featureFlagState } from "../../../shared/feature-flags"

/**
 * Shared pieces for `/vendor/plates/*` (not a route file).
 *
 * Everything under `/vendor/plates` is information for the seller to read.
 * No handler here refuses a request because of what a rule says, and none
 * answers 402, 403 or 409: the only refusals are 401 (not signed in as a
 * seller) and 404 (the flag is off, or the state code is not one this reads).
 * `__tests__/routes.unit.spec.ts` holds the files to that.
 */

/** The program these routes read. The pilot has one. */
export const PLATES_PROGRAM = "home_based_food"

/**
 * Handler-level flag check. `middlewares.ts` gates the `/vendor/plates*`
 * matcher with `requireFeatureFlagMiddleware("PLATES_V1")`; this repeats the
 * same 404 inside each handler so a matcher typo cannot open the routes, and
 * so the routes' own spec can prove the gate without booting the app.
 */
export function platesDisabled(res: MedusaResponse): boolean {
  if (featureFlagState.isEnabled("PLATES_V1")) return false
  res.status(404).json({
    type: "feature_disabled",
    message: `Feature flag ${PHASE0_FEATURE_FLAGS.PLATES_V1} is disabled`,
  })
  return true
}

type ViewSource = NonNullable<RuleViewEntry["citations"][number]["source"]>

/**
 * A source as a seller is shown it: the issuer and title, the document id and
 * the printed date. A document that prints no id or no date reads
 * "not stated" in the `_text` field, with the raw value left null beside it,
 * so a screen never has to decide what an absent date should say.
 */
function sourceForSeller(source: ViewSource | null) {
  if (!source) return null
  return {
    id: source.id,
    issuer: source.issuer,
    title: source.title,
    url: source.url,
    document_id: source.document_id,
    document_id_text: source.document_id ?? NOT_STATED,
    document_date: source.document_date,
    document_date_text: source.document_date ?? NOT_STATED,
    document_date_note: source.document_date_note,
    retrieved_at: source.retrieved_at,
    content_sha256: source.content_sha256,
  }
}

/** One rule as a seller is shown it. A draft is marked as one. */
export function ruleForSeller(rule: RuleViewEntry) {
  return {
    id: rule.id,
    rule_key: rule.rule_key,
    version: rule.version,
    kind: rule.kind,
    display_text: rule.display_text,
    value: rule.value,
    review_status: rule.review_status,
    is_draft: rule.review_status !== "reviewed",
    reviewed_at: rule.reviewed_at,
    reviewer_name: rule.reviewer_name,
    correction_pending: rule.correction_pending,
    effective_from: rule.effective_from,
    effective_date_text: rule.effective_from ?? NOT_STATED,
    effective_note: rule.effective_note,
    citations: rule.citations.map((citation) => ({
      locator: citation.locator,
      quote: citation.quote,
      source: sourceForSeller(citation.source),
    })),
  }
}

export function coverageForSeller(view: RuleView) {
  return {
    status: view.coverage.status,
    status_changed_at: view.coverage.status_changed_at,
    required_rule_keys: view.coverage.required_rule_keys,
    required_keys_not_reviewed: view.coverage.required_keys_not_reviewed,
  }
}
