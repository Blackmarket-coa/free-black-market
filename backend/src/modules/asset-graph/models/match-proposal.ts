import { model } from "@medusajs/framework/utils"

/**
 * MatchProposal
 *
 * Output slot for the matching engine: "given member M's declared
 * assets, manifest X is a candidate project they could join, with
 * score Y." v0 defines the schema only — no engine, no scoring
 * algorithm. The engine lands as a separate workstream.
 *
 * `sensitivity_redacted_view` is the field that makes the row safe to
 * surface in lists. When the matcher operates across sensitivity tiers,
 * the redacted view holds only the fields the requesting member is
 * allowed to see (computed at proposal time). Cryptographic enforcement
 * of room-scoped / match-only is deferred.
 */
const MatchProposal = model.define("match_proposal", {
  id: model.id().primaryKey(),

  /** Slug of the candidate `project_manifest`. */
  manifest_slug: model.text(),

  /** Member the proposal is for. */
  member_id: model.text(),

  /**
   * Declaration ids that satisfied required asset kinds, as a JSON
   * array. Keeps the row narrow; the full graph traversal is
   * reconstructable from the ids.
   */
  declaration_ids: model.json(),

  /** Float 0..1 ranking. v0 reserves the field; the algorithm is post-v0. */
  score: model.float().default(0),

  /** Computed at proposal time; see model docstring. */
  sensitivity_redacted_view: model.json().nullable(),

  /** pending | accepted | declined | expired. */
  state: model.text().default("pending"),

  proposed_at: model.dateTime(),

  resolved_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["manifest_slug"], name: "IDX_match_proposal_manifest_slug" },
  { on: ["member_id"], name: "IDX_match_proposal_member_id" },
  { on: ["state"], name: "IDX_match_proposal_state" },
])

export default MatchProposal
