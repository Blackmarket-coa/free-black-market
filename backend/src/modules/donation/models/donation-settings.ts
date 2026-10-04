import { model } from "@medusajs/framework/utils"

/**
 * Donation settings. Two settlement modes, one of them legacy:
 *
 * - `split_processor` — the donation is collected as a Stripe direct charge ON
 *   the recipient org's own connected account and FBM records it in
 *   `donation_split_record` (docs/POSTURE_A_COMPLIANCE.md rule 10). No money
 *   sits on FBM's books. This is the Phase 1 path behind FF_NONPROFIT_PARITY_V1.
 * - `ledger_batch` — the LEGACY tier-2 fiscal-sponsor / accrual path:
 *   `subscribers/donation-order-accrued.ts` accrues `metadata.accrued_balance`
 *   on a beneficiary and `jobs/donation-batch-disbursement.ts` queues rows
 *   against `fiscal_sponsor_account_id`. That is a balance on FBM's books —
 *   the custody shape legal checkpoint L24 asks counsel about. It is refused
 *   by the admin settings route and both its writers are no-ops while the
 *   flag is on; with the flag off it is unchanged for tenants that have no
 *   Connect account yet. Superseded, not deleted (docs/AUDIT_DEBT.md).
 *
 * The `fiscal_sponsor_*` columns belong to the legacy mode.
 */
const DonationSettings = model.define("donation_settings", {
  id: model.id().primaryKey(),
  is_default: model.boolean().default(true),
  settlement_mode: model.enum(["split_processor", "ledger_batch"]).default("split_processor"),
  default_percentage: model.number().default(2),
  round_up_enabled: model.boolean().default(true),

  /** Fiscal sponsor display name surfaced in the checkout donation widget. */
  fiscal_sponsor_name: model.text().nullable(),
  /**
   * LedgerAccount.id that donations route through. The
   * donation-batch-disbursement job credits this account; the fiscal
   * sponsor then issues donor receipts and disburses to beneficiaries.
   */
  fiscal_sponsor_account_id: model.text().nullable(),
  /** Optional URL the storefront can link to (e.g. sponsor's 501c3 page). */
  fiscal_sponsor_url: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default DonationSettings
