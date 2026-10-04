import { model } from "@medusajs/framework/utils"

/**
 * Vendor Advance (Earnings Advance / Invoice Factoring)
 * Provides cash advances to vendors based on their sales history
 */
export const VendorAdvance = model.define("hawala_vendor_advance", {
  id: model.id().primaryKey(),
  
  // Recipient. SELLER: the historical shape — a seller with a SELLER_EARNINGS
  // ledger account the advance is credited to. PARTNER_ORG (Phase 1b, Decision
  // 6a, L26): a verified nonprofit partner_org, for which the row is a RECORD
  // of an advance disbursed and repaid OUTSIDE the hawala ledger — the org has
  // no ledger account and never gets one (owner_type gains no value), so
  // `vendor_id` and `ledger_account_id` are null and `partner_org_key` +
  // `recipient_snapshot` (the L11-dated verification snapshot, same shape as
  // the pool carrier's) name the recipient instead. No new entry_type or
  // reference_type; the discriminator lives here.
  recipient_type: model.enum(["SELLER", "PARTNER_ORG"]).default("SELLER"),
  vendor_id: model.text().nullable(),
  ledger_account_id: model.text().nullable(),
  partner_org_key: model.text().nullable(),
  recipient_snapshot: model.json().nullable(),
  // The operator's reference for the money that actually moved (e.g. a Stripe
  // transfer id from BMC's own balance to the org's connected account).
  // Required to make a PARTNER_ORG advance ACTIVE; approval is idempotent on it.
  disbursement_reference: model.text().nullable(),
  
  // Advance details
  principal_amount: model.bigNumber(), // Original advance amount
  outstanding_balance: model.bigNumber(), // Current balance owed
  total_repaid: model.bigNumber().default(0), // Total repaid so far
  
  // Fee structure
  fee_type: model.enum([
    "FLAT",           // One-time flat fee
    "WEEKLY_PERCENT", // Weekly percentage (e.g., 1% per week)
    "FACTOR_RATE",    // Factor rate (e.g., 1.15 = 15% total)
  ]).default("FACTOR_RATE"),
  fee_rate: model.bigNumber(), // Rate value based on fee_type
  fee_cap: model.bigNumber().nullable(), // Maximum fee (e.g., 1.25 = 25% max)
  total_fee_charged: model.bigNumber().default(0),
  
  // Repayment
  repayment_method: model.enum([
    "AUTO_DEDUCT",      // Auto-deduct from sales
    "MANUAL",           // Manual payments
    "SCHEDULED",        // Scheduled payments
  ]).default("AUTO_DEDUCT"),
  repayment_rate: model.bigNumber().default(0.2), // 20% of daily sales
  
  // Term
  term_days: model.number().default(30),
  start_date: model.dateTime(),
  expected_end_date: model.dateTime(),
  actual_end_date: model.dateTime().nullable(),
  
  // Eligibility factors (recorded at time of advance)
  eligibility_snapshot: model.json().nullable(), // 30-day avg, history, etc.
  
  // Status
  status: model.enum([
    "PENDING_APPROVAL",
    "APPROVED",
    "ACTIVE",
    "REPAID",
    "DEFAULTED",
    "CANCELED",
  ]).default("PENDING_APPROVAL"),
  
  // Approval
  approved_by: model.text().nullable(),
  approved_at: model.dateTime().nullable(),
  
  // Metadata
  metadata: model.json().nullable(),
})
  // OPTIMIZATION: Add indexes for common query patterns
  .indexes([
    // Index for vendor advance lookups (most common query)
    {
      on: ["vendor_id", "status"],
      name: "idx_vendor_advance_vendor_status",
    },
    // Index for ledger account lookups
    {
      on: ["ledger_account_id"],
      name: "idx_vendor_advance_account",
    },
    // Org-advance lookups by recipient org
    {
      on: ["partner_org_key", "status"],
      name: "IDX_hawala_vendor_advance_org_status",
      where: "deleted_at IS NULL",
    },
  ])

/**
 * Advance Repayment
 * Tracks individual repayments against an advance
 */
export const AdvanceRepayment = model.define("hawala_advance_repayment", {
  id: model.id().primaryKey(),
  
  // References
  advance_id: model.text(),
  ledger_entry_id: model.text().nullable(), // Linked ledger entry
  order_id: model.text().nullable(), // If auto-deducted from sale
  // The payer's / operator's own reference for a MANUAL repayment recorded on
  // a PARTNER_ORG advance (the money moved outside the ledger). The idempotency
  // key, under a partial unique index on (advance_id, external_reference).
  external_reference: model.text().nullable(),
  
  // Amounts
  principal_amount: model.bigNumber(), // Goes toward principal
  fee_amount: model.bigNumber().default(0), // Fee portion
  total_amount: model.bigNumber(), // Total payment
  
  // Balance after
  outstanding_balance_after: model.bigNumber(),
  
  // Method
  repayment_type: model.enum([
    "AUTO_DEDUCT",    // Auto-deducted from sale
    "MANUAL",         // Manual payment
    "ADJUSTMENT",     // Manual adjustment
  ]),
  
  // Status
  status: model.enum([
    "PENDING",
    "COMPLETED",
    "FAILED",
    "REVERSED",
  ]).default("COMPLETED"),

  // Metadata
  metadata: model.json().nullable(),
})
  // OPTIMIZATION: Add indexes for common query patterns
  .indexes([
    // Index for advance repayment lookups
    {
      on: ["advance_id", "status"],
      name: "idx_advance_repayment_advance",
    },
    // Index for order-based lookups
    {
      on: ["order_id"],
      name: "idx_advance_repayment_order",
    },
    // One record per external reference per advance (replays and races)
    {
      on: ["advance_id", "external_reference"],
      name: "UQ_hawala_advance_repayment_external_reference",
      unique: true,
      where: "deleted_at IS NULL AND external_reference IS NOT NULL",
    },
  ])
