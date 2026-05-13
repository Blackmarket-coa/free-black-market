import { model } from "@medusajs/framework/utils"

/**
 * Refrain bounty.
 *
 * A bounty is the connection-and-payment record between a patron
 * (poster, typically a vendor or member) and a creator. The amount
 * column is the gross bounty escrowed up front; the rights and
 * pricing modes are pinned at creation time and carried through to
 * the EscrowAgreement that holds the funds.
 *
 * Status transitions are enforced in `service.ts` against
 * `BOUNTY_TRANSITIONS` from `policy.ts`.
 *
 * See `docs/COMPOSITION_LAYER.md` and the Refrain module's
 * `policy.ts`.
 */
const Bounty = model.define("refrain_bounty", {
  id: model.id().primaryKey(),

  /** BMC member id that posted the bounty. */
  posted_by_member_id: model.text(),
  /** Creator id (Refrain profile, NOT a seller_id) that claimed it. */
  claimed_by_creator_id: model.text().nullable(),

  title: model.text(),
  description: model.text().nullable(),

  /** Minor units (cents). */
  amount_minor: model.bigNumber(),
  currency_code: model.text(),

  pricing_mode: model.enum(["fixed", "competitive"]).default("fixed"),
  rights_mode: model
    .enum(["creator_retains", "shared_attribution", "license_to_poster"])
    .default("creator_retains"),

  /**
   * Time-locked auto-release window. After this many days from
   * submission, the EscrowAgreement auto-accepts if the poster
   * hasn't responded.
   */
  review_window_days: model.number().default(14),

  status: model
    .enum([
      "draft",
      "posted",
      "claimed",
      "submitted",
      "accepted",
      "rejected",
      "expired",
      "cancelled",
    ])
    .default("draft"),

  /** EscrowAgreement.id holding the bounty amount. Null pre-posting. */
  escrow_agreement_id: model.text().nullable(),

  posted_at: model.dateTime().nullable(),
  claimed_at: model.dateTime().nullable(),
  submitted_at: model.dateTime().nullable(),
  resolved_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
})
.indexes([
  { on: ["posted_by_member_id"], name: "IDX_refrain_bounty_posted_by" },
  {
    on: ["claimed_by_creator_id"],
    name: "IDX_refrain_bounty_claimed_by",
  },
  { on: ["status"], name: "IDX_refrain_bounty_status" },
])

export default Bounty
