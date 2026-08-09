import { model } from "@medusajs/framework/utils"

/**
 * PlaybookTransition — append-only ledger of playbook changes.
 *
 * `PlaybookAssignment` is unique by `seller_id` and updated in place, so
 * switching playbooks previously left no trace: its doc comment claimed a
 * history trail existed "via the audit log", but nothing durable was written.
 * This is that trail, following the same append-only convention as
 * `vendor-quest/models/quest-stage-event.ts` — one row per change, never
 * mutated, never deleted.
 *
 * Rows are written for every change, not only for declared progressions. A move
 * that matches no edge in `progressions.ts` is still a real thing that happened
 * and still belongs in the history; `matched_progression` records which kind it
 * was, which is also how we learn whether the declared edge set matches what
 * vendors actually do.
 */
const PlaybookTransition = model.define("playbook_transition", {
  id: model.id().primaryKey(),

  seller_id: model.text(),

  /**
   * Null for the seller's very first assignment — there is no `from` when a
   * vendor picks their opening playbook, and recording one would invent a
   * transition that never happened.
   */
  from_recipe_id: model.text().nullable(),
  to_recipe_id: model.text(),

  /** `replace` | `add_role`, from the matched edge; null when unmatched. */
  kind: model.text().nullable(),

  /** Engine ids from the matched edge (`facility`, `governance`, …). */
  engines: model.json().nullable(),

  /** True when this move corresponds to a declared edge in `progressions.ts`. */
  matched_progression: model.boolean().default(false),

  /** Free text the vendor optionally supplied. Never required, never inferred. */
  reason: model.text().nullable(),

  /**
   * How many of the seller's existing products carried a listing-type the
   * target playbook does not allow, counted at transition time.
   *
   * Recorded rather than enforced: allowed-listing-types is checked on write
   * (see `shared/listing-type-guard.ts`), so existing products keep working and
   * keep selling. This is the number the vendor was shown, kept so the advice
   * can be audited later.
   */
  stranded_listing_count: model.number().default(0),

  occurred_at: model.dateTime(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["seller_id"], name: "IDX_playbook_transition_seller_id" },
  { on: ["to_recipe_id"], name: "IDX_playbook_transition_to_recipe_id" },
])

export default PlaybookTransition
