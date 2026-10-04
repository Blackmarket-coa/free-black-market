import { model } from "@medusajs/framework/utils"

/**
 * collective_campaign_contribution — one succeeded direct charge on a
 * participant organisation's own connected account, as reported by the Connect
 * webhook, keyed by the Stripe PaymentIntent it came from.
 *
 * This row is the idempotency key for the shared-goal count: the partial unique
 * index on (campaign_id, stripe_payment_intent_id) is enforced by Postgres, so
 * two concurrent deliveries of the same `payment_intent.succeeded` cannot both
 * count — one insert fails and `recordParticipantContribution` reports
 * `already_recorded`. The key is derived from the record (the intent), never
 * from the delivery attempt. Participant and campaign totals are DERIVED from
 * these rows (sum of the un-reversed ones), not incremented, so a stale cached
 * total converges on the next write instead of drifting.
 *
 * `reversed_at` is set when the processor reports a FULL refund of the intent;
 * the row stays for reconciliation and stops counting. `amount_cents` is
 * INTEGER CENTS — Stripe's gross, never the metadata's.
 *
 * A record of what the processor did on the org's OWN account, not a balance:
 * no funds are held, owed or disbursed from it (Posture A rule 10, L24). No
 * `customer_id`: the donor is on `donation_split_record`, which the
 * customer-data registry already covers; this row names organisations only.
 */
const Contribution = model
  .define("collective_campaign_contribution", {
    id: model.id({ prefix: "cccon" }).primaryKey(),
    campaign_id: model.text(),
    participant_id: model.text(),
    /** The participant's partner-directory org key at the time of the charge. */
    partner_org_key: model.text(),
    /** The PaymentIntent on the org's connected account. One row per intent per campaign. */
    stripe_payment_intent_id: model.text(),
    amount_cents: model.number(),
    reversed_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["campaign_id", "stripe_payment_intent_id"],
      unique: true,
      name: "UQ_collective_campaign_contribution_campaign_intent",
      where: "deleted_at IS NULL",
    },
    {
      on: ["campaign_id"],
      name: "IDX_collective_campaign_contribution_campaign_id",
      where: "deleted_at IS NULL",
    },
    {
      on: ["participant_id"],
      name: "IDX_collective_campaign_contribution_participant_id",
      where: "deleted_at IS NULL",
    },
  ])

export default Contribution
