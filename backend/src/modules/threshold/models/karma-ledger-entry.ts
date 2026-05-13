import { model } from "@medusajs/framework/utils"

/**
 * Threshold Karma ledger entry.
 *
 * Karma is the anti-hoarding balance for mutual-aid (tool libraries
 * borrow/return, free-store check-in/check-out). It is **not** money
 * and is **not** convertible to Credits or USD. The unit is whole
 * numbers — there's no minor-unit accounting. Karma can be negative
 * temporarily (you owe back a tool you borrowed) but is rebalanced
 * by the tool/library admin, not by FBM platform automation.
 *
 * Per `docs/COMPOSITION_LAYER.md`: "Credits never substitute for
 * mutual-aid gifting (that would collapse the gift economy). A
 * separate Karma asset tracks anti-hoarding balance for tool
 * libraries and free stores."
 */
const KarmaLedgerEntry = model.define("threshold_karma_ledger_entry", {
  id: model.id().primaryKey(),

  /** BMC member id whose balance is moving. */
  member_id: model.text(),

  /** The Threshold post that anchors this entry. */
  post_id: model.text().nullable(),

  /**
   * Positive = balance up (returned a tool, contributed to fridge);
   * negative = balance down (borrowed a tool, took something from
   * the fridge).
   */
  delta: model.number(),

  /** Short reason; surfaced to the member in their Karma timeline. */
  reason: model.text(),

  metadata: model.json().nullable(),
})
.indexes([
  { on: ["member_id"], name: "IDX_threshold_karma_member_id" },
  { on: ["post_id"], name: "IDX_threshold_karma_post_id" },
])

export default KarmaLedgerEntry
