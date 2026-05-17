import { model } from "@medusajs/framework/utils"

/**
 * Posture A — donations routed through a 501(c)(3) fiscal sponsor.
 *
 * Under FinCEN's payment-processor exemption FBM does not maintain
 * the donor-recipient relationship directly. The fiscal sponsor
 * (Allied Media Projects, NEO Philanthropy, Tides Foundation, or an
 * SELC-recommended local sponsor) handles state charity registration
 * (~40 states) and issues donor receipts. FBM is a routing layer.
 *
 * See `docs/POSTURE_A_COMPLIANCE.md`.
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
