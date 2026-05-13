import { model } from "@medusajs/framework/utils"

/**
 * Refrain bounty submission.
 *
 * One row per submitted deliverable. In `competitive` pricing mode a
 * single bounty has many submissions; in `fixed` mode there is at most
 * one accepted submission and the bounty stays in `claimed` until that
 * row arrives.
 *
 * The deliverable_url is intentionally generic — Refrain is
 * platform-agnostic, so the URL can point to YouTube, Bandcamp,
 * Substack, TikTok, IPFS, or anywhere else the creator already
 * publishes (see `docs/COMPOSITION_LAYER.md` § "Not a Patreon").
 */
const BountySubmission = model.define("refrain_bounty_submission", {
  id: model.id().primaryKey(),

  bounty_id: model.text(),
  creator_id: model.text(),

  deliverable_url: model.text().nullable(),
  notes: model.text().nullable(),

  status: model
    .enum(["submitted", "accepted", "rejected", "withdrawn"])
    .default("submitted"),

  reviewed_at: model.dateTime().nullable(),
  reviewer_note: model.text().nullable(),

  metadata: model.json().nullable(),
})
.indexes([
  { on: ["bounty_id"], name: "IDX_refrain_submission_bounty_id" },
  { on: ["creator_id"], name: "IDX_refrain_submission_creator_id" },
  { on: ["status"], name: "IDX_refrain_submission_status" },
])

export default BountySubmission
