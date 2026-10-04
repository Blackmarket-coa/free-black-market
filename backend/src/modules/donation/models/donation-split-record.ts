import { model } from "@medusajs/framework/utils"

export const DONATION_SPLIT_KINDS = ["donation", "donation_pledge"] as const
export type DonationSplitKind = (typeof DONATION_SPLIT_KINDS)[number]

export const DONATION_SPLIT_STATUSES = ["created", "succeeded", "refunded", "failed"] as const
export type DonationSplitStatus = (typeof DONATION_SPLIT_STATUSES)[number]

/**
 * donation_split_record — a RECORD of a direct-charge donation, never a balance.
 *
 * One row per Stripe PaymentIntent created ON the recipient org's connected
 * account (docs/POSTURE_A_COMPLIANCE.md rule 10; legal checkpoint L24). The
 * money settles on the org's own Stripe balance; this row is FBM's bookkeeping
 * of what the processor did, so transparency pages and donor receipts can be
 * reconciled against Stripe.
 *
 * Why it is not a `hawala_ledger_entry`: `createTransfer` needs two
 * `LedgerAccount`s and mutates their cached balances — the custody shape
 * Posture A rule 3 forbids — and the hawala guard cannot see USD at all
 * (`posture-a-guard.ts` passes USD through). No `PURCHASE_CONTEXT_REFERENCE_TYPES`
 * or `reference_type` enum changes anywhere; `reference-type-parity.unit.spec.ts`
 * stays green and proves it.
 *
 * What is deliberately absent: any balance, accrued or pending-amount column.
 * `gross_cents` is what the donor paid, `processor_fee_cents` is Stripe's fee
 * borne by the org (display only; from the balance transaction when known),
 * and `bmc_fee_cents` is 0 by DB CHECK — the row cannot say BMC took a cut.
 *
 * The recipient's verification status, IRS file date and org type are frozen
 * here at charge time (L11): a later revocation must not rewrite what was
 * true when the donor gave. `recipient_snapshot_at` is when the freeze
 * happened; `recipient_verified_as_of` is the IRS file's date, null for a
 * coop / unincorporated org the IRS has no file for.
 *
 * `customer_id` is nullable (guests may donate) and registered in
 * `lib/customer-data-registry.ts` as `anonymise`: the row stays for
 * reconciliation, the donor link does not.
 */
const DonationSplitRecord = model
  .define("donation_split_record", {
    id: model.id({ prefix: "dsr" }).primaryKey(),
    /** The PaymentIntent on the connected account. Unique: one row per intent. */
    stripe_payment_intent_id: model.text(),
    /** The connected account the intent was created ON (`event.account`). */
    stripe_account_id: model.text(),
    org_key: model.text(),
    campaign_id: model.text().nullable(),
    kind: model.enum([...DONATION_SPLIT_KINDS]).default("donation"),
    currency_code: model.text().default("usd"),
    gross_cents: model.number(),
    /** Always 0; the migration adds a CHECK so the DB refuses anything else. */
    bmc_fee_cents: model.number().default(0),
    /** Stripe's fee on the org's account, for display. Null until known. */
    processor_fee_cents: model.number().nullable(),
    /**
     * `charge.amount_refunded` as the processor reported it. Below the gross
     * the refund is partial and `status` stays; at the gross it is `refunded`.
     * A record of what Stripe did, not a balance.
     */
    refunded_cents: model.number().nullable(),
    recipient_org_type: model.text().nullable(),
    recipient_verification_status: model.text(),
    recipient_verified_as_of: model.dateTime().nullable(),
    recipient_snapshot_at: model.dateTime(),
    status: model.enum([...DONATION_SPLIT_STATUSES]).default("created"),
    customer_id: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  // Mirrors the hand-written migration exactly (DML adds `WHERE deleted_at IS
  // NULL` to each); a `db:generate` diff must not emit DROP INDEX for the
  // unique intent index the idempotency story rests on.
  .indexes([
    { on: ["stripe_payment_intent_id"], unique: true, name: "IDX_donation_split_record_intent_unique" },
    { on: ["org_key"], name: "IDX_donation_split_record_org_key" },
    { on: ["status"], name: "IDX_donation_split_record_status" },
    { on: ["customer_id"], name: "IDX_donation_split_record_customer_id" },
  ])

export default DonationSplitRecord
