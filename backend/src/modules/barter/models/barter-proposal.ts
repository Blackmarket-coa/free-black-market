import { model } from "@medusajs/framework/utils"

export enum BarterStatus {
  PROPOSED = "PROPOSED",
  ACCEPTED = "ACCEPTED",
  DECLINED = "DECLINED",
  COMPLETED = "COMPLETED",
  WITHDRAWN = "WITHDRAWN",
}

/**
 * An offer to fulfil a demand post or bounty by trade rather than cash.
 *
 * The brief's fourth value-add: barter as a first-class fulfilment path, not a
 * cash-only marketplace with a swap bolted on. A demand pool exists because
 * people want a thing; whether that want is met with money or with a trade is
 * a settlement detail, and hard-coding "money" into the only fulfilment route
 * is what makes every competitor category cash-only.
 *
 * `offering` and `wanting` are free text on purpose. Barter is exactly the
 * domain where a taxonomy fails: the whole point is that someone can offer
 * three hours of plumbing for a chest freezer, and no category tree survives
 * contact with that. Matching here is human, and the model's job is to record
 * the agreement rather than to classify it.
 *
 * Settlement is recorded as a **zero-value** ledger entry. That is deliberate:
 * a barter is a real event the pool's ledger trail should show, but no
 * monetary value moved, and booking a notional one would corrupt the very
 * arithmetic Phase 7 invites people to check.
 *
 * The GIFT rail ("non-settling, recorded as zero-value flow for audit") is the
 * natural home for these, but a rail is a property of the *accounts* and
 * `createTransfer` takes no currency code — so until GIFT-denominated accounts
 * exist, the entry sits on the parties' wallets at zero and carries
 * `intended_rail: "GIFT"` in metadata rather than claiming a rail it is not on.
 */
const BarterProposal = model.define("barter_proposal", {
  id: model.id().primaryKey(),

  /** What this fulfils. Exactly one is set. */
  demand_post_id: model.text().nullable(),
  bounty_id: model.text().nullable(),

  proposer_id: model.text(),

  /** What the proposer will provide. */
  offering: model.text(),
  /** What they want back. */
  wanting: model.text(),

  /** Optional hours figure when the trade is labour, for time-bank framing. */
  estimated_hours: model.float().nullable(),

  status: model.enum(Object.values(BarterStatus)).default(BarterStatus.PROPOSED),

  /** The demand-post creator who accepted; only they can. */
  accepted_by: model.text().nullable(),
  accepted_at: model.dateTime().nullable(),
  completed_at: model.dateTime().nullable(),

  /** GIFT-rail entry recording the completed trade for audit. */
  ledger_entry_id: model.text().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["demand_post_id"], name: "IDX_barter_demand_post" },
  { on: ["bounty_id"], name: "IDX_barter_bounty" },
  { on: ["proposer_id"], name: "IDX_barter_proposer" },
  { on: ["status"], name: "IDX_barter_status" },
])

export default BarterProposal
