/**
 * Manifest matcher.
 *
 * Pure-function engine that answers: given a project manifest and a
 * pool of member-side AssetDeclarations, which declarations satisfy
 * which manifest slot, and which members could deploy the manifest as
 * its operator?
 *
 * The matcher is decomposed so each axis the schema cares about is its
 * own testable function:
 *
 *   matchesKindSlug      already in seed/asset-kinds.ts — wildcard
 *                        and exact taxonomy slug matching.
 *
 *   evaluateConstraints  per-slot `constraints: { <key>: value }` JSON
 *                        evaluated against a declaration's `attributes`
 *                        JSON. v0.1 vocabulary:
 *                          <key>_min   → attributes[key] >= value
 *                          <key>_max   → attributes[key] <= value
 *                          <key>       → attributes[key] === value
 *                        Anything else throws so a typo in a manifest
 *                        constraint surfaces loudly.
 *
 *   matchSlot            walks a pool of declarations against a single
 *                        manifest slot (kind_slug + lifecycle filter +
 *                        constraints). Returns candidate declarations.
 *
 *   matchManifest        assembles per-slot reports for the full
 *                        manifest and identifies candidate operators
 *                        (members who have at least one declaration in
 *                        a manifest's host / operator / operator-or-
 *                        shared / coordinator role).
 *
 *   proposalsFromReport  turns a match report into MatchProposal-shape
 *                        payloads — one per candidate operator. The
 *                        proposal carries the operator's
 *                        member_id, the declaration_ids of every
 *                        slot-satisfying declaration in the report, a
 *                        completion flag (every required slot has
 *                        ≥ min_count candidates), and a default
 *                        score of 0 (scoring algorithm is post-v0.1).
 *
 * Out of scope for v0.1:
 *
 *   - Scoring beyond 0/1 completeness. The score field is reserved.
 *
 *   - Event-loop scheduling. Repair-café-style fixer-availability vs.
 *     event-date vs. venue-recurrence coordination requires a primitive
 *     the playbook + listing-type spine doesn't have yet. The slot-
 *     level match still works (e.g. a fixer's
 *     `time.event-shift` declaration satisfies the slot if its
 *     lifecycle is perishable); proposing the *right* date is deferred.
 *
 *   - Sensitivity-tier redaction. The proposal's
 *     `sensitivity_redacted_view` is left null in v0.1; redaction
 *     enforcement requires the Blackout E2EE work.
 *
 *   - Geography filtering. Declarations have a geography JSON column
 *     and manifests will eventually carry a service-area constraint,
 *     but v0.1 considers the global pool.
 */

import type {
  ProjectManifestRecipe,
  RequiredAssetKindT,
  ManifestRoleT,
} from "./manifests/types"
import { matchesKindSlug } from "./seed/asset-kinds"

/**
 * Minimal AssetDeclaration shape the matcher reads. The full DB model
 * has more fields (geography, attestations, availability windows);
 * this type names only what the matcher needs so callers can hand in
 * either a DB row or an in-memory fixture.
 */
export type MatcherDeclaration = {
  id: string
  member_id: string
  kind_slug: string
  attributes: Record<string, unknown>
  sensitivity_tier?: string
  lifecycle?: string
  revoked_at?: Date | null
}

/** A single slot's matches against the declaration pool. */
export type SlotReport = {
  slot: RequiredAssetKindT
  /** Declarations that satisfy this slot. */
  candidates: Array<{ declaration_id: string; member_id: string }>
  /** True when `candidates.length >= slot.min_count` or the slot is optional. */
  satisfied: boolean
}

/** Full manifest match report. */
export type ManifestMatchReport = {
  manifest_slug: string
  slot_reports: SlotReport[]
  /** True when every required (non-optional) slot is satisfied. */
  satisfied: boolean
  /** Members who have at least one declaration in an operator-like role. */
  candidate_operators: Array<{
    member_id: string
    /** This member's declaration ids that satisfy any slot. */
    own_declaration_ids: string[]
  }>
}

/**
 * Roles that can serve as the "operator" anchor for a project
 * instance. A proposal is emitted per candidate operator; these roles
 * are the ones whose presence indicates "this member could deploy
 * the manifest." Multi-stakeholder manifests can have several
 * candidate operators (any one of them deploys; the others join).
 */
export const OPERATOR_LIKE_ROLES: ReadonlySet<ManifestRoleT> = new Set<ManifestRoleT>([
  "operator",
  "operator-or-shared",
  "host",
  "coordinator",
  "librarian",
])

/**
 * Constraint evaluator. v0.1 vocabulary:
 *
 *   { <field>_min: N }   attributes[field]  must be >= N
 *   { <field>_max: N }   attributes[field]  must be <= N
 *   { <field>: <value> } attributes[field]  must === value
 *
 * Unknown vocabulary keys throw. A manifest can be wrong about its
 * own attributes, but the matcher shouldn't paper over typos — the
 * orthogonality tests already cover slug typos, and this completes the
 * picture for attribute typos.
 *
 * Missing attributes treated as constraint failure (not crash).
 */
export const evaluateConstraints = (
  constraints: Record<string, unknown> | undefined,
  attributes: Record<string, unknown>
): boolean => {
  if (!constraints) return true
  for (const [key, expected] of Object.entries(constraints)) {
    if (key.endsWith("_min")) {
      const field = key.slice(0, -"_min".length)
      const actual = attributes[field]
      if (typeof actual !== "number" || typeof expected !== "number") {
        return false
      }
      if (actual < expected) return false
    } else if (key.endsWith("_max")) {
      const field = key.slice(0, -"_max".length)
      const actual = attributes[field]
      if (typeof actual !== "number" || typeof expected !== "number") {
        return false
      }
      if (actual > expected) return false
    } else {
      // Exact match on a non-suffixed key.
      if (attributes[key] !== expected) return false
    }
  }
  return true
}

/** Walk declarations against a single manifest slot. */
export const matchSlot = (
  slot: RequiredAssetKindT,
  pool: ReadonlyArray<MatcherDeclaration>
): SlotReport => {
  const candidates: SlotReport["candidates"] = []
  for (const decl of pool) {
    if (decl.revoked_at) continue
    if (!matchesKindSlug(slot.kind_slug, decl.kind_slug)) continue
    if (slot.lifecycle && decl.lifecycle !== slot.lifecycle) continue
    if (!evaluateConstraints(slot.constraints, decl.attributes)) continue
    candidates.push({ declaration_id: decl.id, member_id: decl.member_id })
  }
  const minCount = slot.min_count ?? 1
  const satisfied = slot.optional ? true : candidates.length >= minCount
  return { slot, candidates, satisfied }
}

/** Assemble per-slot reports + candidate operators for a manifest. */
export const matchManifest = (
  manifest: ProjectManifestRecipe,
  pool: ReadonlyArray<MatcherDeclaration>
): ManifestMatchReport => {
  const slot_reports: SlotReport[] = manifest.required_asset_kinds.map((slot) =>
    matchSlot(slot, pool)
  )
  const satisfied = slot_reports.every((r) => r.satisfied)

  // Candidate operators: members who have at least one declaration
  // satisfying an operator-like role slot.
  const operatorMembers = new Map<string, Set<string>>()
  for (const report of slot_reports) {
    if (!OPERATOR_LIKE_ROLES.has(report.slot.role)) continue
    for (const c of report.candidates) {
      if (!operatorMembers.has(c.member_id)) {
        operatorMembers.set(c.member_id, new Set())
      }
      operatorMembers.get(c.member_id)!.add(c.declaration_id)
    }
  }

  // For each candidate operator, also include their declarations that
  // satisfy non-operator slots — the proposal carries everything they
  // bring, not just the operator-role declaration.
  for (const report of slot_reports) {
    if (OPERATOR_LIKE_ROLES.has(report.slot.role)) continue
    for (const c of report.candidates) {
      if (operatorMembers.has(c.member_id)) {
        operatorMembers.get(c.member_id)!.add(c.declaration_id)
      }
    }
  }

  const candidate_operators = [...operatorMembers.entries()]
    .map(([member_id, ids]) => ({
      member_id,
      own_declaration_ids: [...ids].sort(),
    }))
    .sort((a, b) => a.member_id.localeCompare(b.member_id))

  return {
    manifest_slug: manifest.slug,
    slot_reports,
    satisfied,
    candidate_operators,
  }
}

/**
 * Match-proposal payload shape. Mirrors the DB model, sans
 * persistence-only fields (id, audit columns). Callers persist via
 * the AssetGraph service.
 */
export type MatchProposalPayload = {
  manifest_slug: string
  member_id: string
  /** Every declaration id across all slots in this report. */
  declaration_ids: string[]
  /**
   * 0..1. v0.1 emits 0 for incomplete and 1 for complete; a richer
   * scoring algorithm is post-v0.1 (weighted by attestation tier,
   * geography proximity, member karma).
   */
  score: number
  sensitivity_redacted_view: null
  state: "pending"
  proposed_at: Date
}

/**
 * Turn a manifest match report into proposal payloads — one per
 * candidate operator. Returns an empty array when no member has an
 * operator-like role declaration; that means the manifest is not yet
 * deployable, even partially.
 */
export const proposalsFromReport = (
  report: ManifestMatchReport,
  now: Date = new Date()
): MatchProposalPayload[] => {
  // The full constellation of declaration ids that satisfy every slot
  // — shared by all proposals from this report, so each proposal can
  // surface who their co-participants would be.
  const allDeclarationIds = Array.from(
    new Set(
      report.slot_reports.flatMap((s) =>
        s.candidates.map((c) => c.declaration_id)
      )
    )
  ).sort()

  return report.candidate_operators.map((op) => ({
    manifest_slug: report.manifest_slug,
    member_id: op.member_id,
    declaration_ids: allDeclarationIds,
    score: report.satisfied ? 1 : 0,
    sensitivity_redacted_view: null,
    state: "pending" as const,
    proposed_at: now,
  }))
}
