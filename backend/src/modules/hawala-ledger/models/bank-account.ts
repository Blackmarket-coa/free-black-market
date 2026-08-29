import { model } from "@medusajs/framework/utils"

/**
 * ACH Bank Account
 * Linked bank accounts for ACH direct debit via Stripe
 */
export const BankAccount = model.define("hawala_bank_account", {
  id: model.id().primaryKey(),
  
  // Owner
  owner_type: model.enum(["CUSTOMER", "SELLER", "PRODUCER"]),
  owner_id: model.text(),
  
  // Linked ledger account
  ledger_account_id: model.text().nullable(),
  
  // Stripe references
  stripe_customer_id: model.text(),
  stripe_bank_account_id: model.text(), // ba_xxx or pm_xxx
  stripe_payment_method_id: model.text().nullable(), // For new payment methods
  
  // Bank details (masked)
  bank_name: model.text().nullable(),
  last_four: model.text(), // Last 4 digits of account
  routing_number_last_four: model.text().nullable(),
  account_holder_name: model.text().nullable(),
  account_type: model.enum(["CHECKING", "SAVINGS"]).default("CHECKING"),
  
  // Verification status
  verification_status: model.enum([
    "PENDING",
    "VERIFIED",
    "VERIFICATION_FAILED",
    "ERRORED",
    "DISCONNECTED",
  ]).default("PENDING"),
  
  // For micro-deposit verification
  verification_method: model.enum([
    "INSTANT",        // Plaid/instant verification
    "MICRO_DEPOSIT",  // Two micro-deposits
    "MANUAL",         // Manual verification
  ]).nullable(),
  
  // Default account
  is_default: model.boolean().default(false),
  
  // Status
  status: model.enum([
    "ACTIVE",
    "INACTIVE",
    "REMOVED",
  ]).default("ACTIVE"),
  
  // Metadata
  metadata: model.json().nullable(),
  
  verified_at: model.dateTime().nullable(),
})

/**
 * ACH Transaction
 * Tracks ACH deposit/withdrawal transactions
 */
export const AchTransaction = model.define("hawala_ach_transaction", {
  id: model.id().primaryKey(),
  
  // Bank account reference
  bank_account_id: model.text(),
  ledger_account_id: model.text(),
  
  // Transaction type
  transaction_type: model.enum([
    "DEPOSIT",    // ACH debit (money in)
    "WITHDRAWAL", // ACH credit (money out)
  ]),
  
  // Amount
  amount: model.bigNumber(),
  currency_code: model.text().default("USD"),
  
  // Fees
  stripe_fee: model.bigNumber().nullable(), // 0.8% capped at $5
  net_amount: model.bigNumber(), // amount - fees
  
  // Stripe references
  stripe_payment_intent_id: model.text().nullable(),
  stripe_charge_id: model.text().nullable(),
  stripe_transfer_id: model.text().nullable(), // For withdrawals
  // The column has existed in the DDL since Migration20251229CreateHawalaLedger
  // but was missing from this model, so the payout.paid / payout.failed webhook
  // filters (api/webhooks/hawala/stripe/route.ts) could never match a row and
  // outbound payout ids went unpersisted. It is also the primary join key for
  // external reconciliation against Stripe payout records.
  stripe_payout_id: model.text().nullable(),

  // Status
  status: model.enum([
    "PENDING",
    "PROCESSING",
    "SUCCEEDED",
    "COMPLETED",
    "FAILED",
    "CANCELED",
    "DISPUTED",
  ]).default("PENDING"),
  
  // ACH-specific
  ach_return_code: model.text().nullable(), // R01, R02, etc. if returned
  failure_reason: model.text().nullable(),
  failed_at: model.dateTime().nullable(),
  
  // Settlement timeline
  expected_settlement_date: model.dateTime().nullable(),
  actual_settlement_date: model.dateTime().nullable(),
  
  // Ledger entry created
  ledger_entry_id: model.text().nullable(),
  
  // Idempotency
  idempotency_key: model.text().unique().nullable(),
  
  // Metadata
  metadata: model.json().nullable(),
})
