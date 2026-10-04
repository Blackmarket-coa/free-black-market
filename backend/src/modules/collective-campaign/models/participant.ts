import { model } from "@medusajs/framework/utils"

/** Roles an organisation can hold on a shared-goal campaign. */
export enum CampaignParticipantRole {
  /** The campaign's host: the one actor allowed to add participants and milestones. */
  HOST = "HOST",
  /** A collective (seller) taking part. */
  COLLECTIVE = "COLLECTIVE",
  /** A partner organisation (partner-directory `partner_org.key`). */
  PARTNER = "PARTNER",
  /** A sponsor whose contribution is counted but who runs nothing. */
  SPONSOR = "SPONSOR",
}

/**
 * collective_campaign_participant — one organisation's role and totals on a
 * shared-goal campaign.
 *
 * `partner_org_key` is the partner-directory org key (S5): the Connect webhook
 * matches a `donation_split_record.org_key` to it to attribute a contribution.
 * `seller_id` is the MercurJS seller for a HOST or COLLECTIVE row. Either may be
 * null, never both. Attribution is by `partner_org_key` only — the split record
 * carries an org key and no seller — so a row with no `partner_org_key` is
 * display-only and can never receive a contribution; a host that expects to
 * collect must be created with `host_partner_org_key`.
 *
 * Amounts are INTEGER CENTS, unlike the campaign's own money columns, which are
 * major units; `money.ts` converts at the boundary and nothing mixes the two.
 * `contributed_amount_cents` is a running total of what the processor reported
 * on the org's OWN connected account — a record, not a balance: no funds are
 * held, owed or disbursed from it (Posture A rule 10, L24).
 *
 * No `customer_id`: participants are organisations, never donors. If a donor
 * link is ever added it must be named `customer_id` so the registry drift test
 * sees it.
 */
const Participant = model
  .define("collective_campaign_participant", {
    id: model.id({ prefix: "ccpart" }).primaryKey(),
    campaign_id: model.text(),
    partner_org_key: model.text().nullable(),
    seller_id: model.text().nullable(),
    role: model.enum(Object.values(CampaignParticipantRole)),
    pledged_amount_cents: model.number().default(0),
    contributed_amount_cents: model.number().default(0),
    metadata: model.json().nullable(),
  })
  // Mirrors Migration20261003SharedGoal exactly (all partial on deleted_at).
  .indexes([
    { on: ["campaign_id"], name: "IDX_collective_campaign_participant_campaign_id", where: "deleted_at IS NULL" },
    {
      on: ["campaign_id", "role"],
      name: "IDX_collective_campaign_participant_campaign_role",
      where: "deleted_at IS NULL",
    },
    // One row per org per campaign (nulls are distinct, so seller-only rows fall to the next index).
    {
      on: ["campaign_id", "partner_org_key"],
      unique: true,
      name: "UQ_collective_campaign_participant_campaign_org",
      where: "deleted_at IS NULL",
    },
    // One row per seller-only participant per campaign. Such rows are display-only:
    // the Connect webhook attributes by `partner_org_key`, which they lack.
    {
      on: ["campaign_id", "seller_id"],
      unique: true,
      name: "UQ_collective_campaign_participant_campaign_seller",
      where: "deleted_at IS NULL AND partner_org_key IS NULL",
    },
    // One HOST per campaign, set at creation.
    {
      on: ["campaign_id"],
      unique: true,
      name: "UQ_collective_campaign_participant_one_host",
      where: "deleted_at IS NULL AND role = 'HOST'",
    },
  ])

export default Participant
