import type { CoverageStatus, RuleReviewStatus } from "./types"

/**
 * Coverage, as a pure function of the rule versions on file.
 *
 * A jurisdiction is `covered` when, and only when, every key its coverage row
 * requires has a reviewed version in force. Nothing else sets `covered`: there
 * is no column to flip and no route that writes it. The service recomputes
 * this in the same transaction as every sign-off, new draft and withdrawal.
 */

/** The part of a rule version this decision reads. */
export type RuleVersionState = {
  rule_key: string
  review_status: RuleReviewStatus
  superseded_at: Date | string | null
  withdrawn_at: Date | string | null
}

/** In force: neither replaced by a later version nor withdrawn. */
export function inForce(version: RuleVersionState): boolean {
  return version.superseded_at == null && version.withdrawn_at == null
}

/** Keys with a reviewed version in force. A draft never counts, whatever else exists for its key. */
export function reviewedKeysInForce(versions: RuleVersionState[]): Set<string> {
  return new Set(versions.filter((v) => v.review_status === "reviewed" && inForce(v)).map((v) => v.rule_key))
}

/** The required keys that still have no reviewed version in force, in the order they are required. */
export function requiredKeysNotReviewed(requiredRuleKeys: string[], versions: RuleVersionState[]): string[] {
  const reviewed = reviewedKeysInForce(versions)
  return requiredRuleKeys.filter((key) => !reviewed.has(key))
}

/**
 * - no versions at all: `not_covered`;
 * - versions exist and none is in force (all withdrawn): `withdrawn`;
 * - every required key reviewed and in force, and at least one key required:
 *   `covered`;
 * - otherwise `draft`.
 *
 * An empty required list is never `covered`. "Every one of no keys" is true of
 * anything, and a jurisdiction must not read as covered because nobody said
 * what covering it takes.
 */
export function coverageStatusOf(requiredRuleKeys: string[], versions: RuleVersionState[]): CoverageStatus {
  if (versions.length === 0) return "not_covered"
  if (!versions.some(inForce)) return "withdrawn"
  if (requiredRuleKeys.length > 0 && requiredKeysNotReviewed(requiredRuleKeys, versions).length === 0) {
    return "covered"
  }
  return "draft"
}
