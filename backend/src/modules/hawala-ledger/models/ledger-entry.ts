import { model } from "@medusajs/framework/utils"

/**
 * Hawala Ledger Entry
 * Double-entry bookkeeping - every transaction has debit and credit entries
 * 
 * Entry Types:
 * - DEPOSIT: Fiat deposit (Stripe ACH)
 * - WITHDRAWAL: Fiat withdrawal
 * - TRANSFER: Internal transfer between accounts
 * - PURCHASE: Product purchase
 * - INVESTMENT: Micro-investment into producer pool
 * - DIVIDEND: Return on investment
 * - COMMISSION: Platform fee
 * - SETTLEMENT: Blockchain settlement
 * - REFUND: Order refund
 * - ADJUSTMENT: Manual adjustment
 */
export const LedgerEntry = model.define("hawala_ledger_entry", {
  id: model.id().primaryKey(),
  
  // Double-entry references
  debit_account_id: model.text(), // Account being debited (money leaving)
  credit_account_id: model.text(), // Account being credited (money entering)
  
  // Amount (always positive, direction determined by debit/credit)
  amount: model.bigNumber(), // Stored as NUMERIC(20,8) for precision
  currency_code: model.text().default("USD"),
  
  // Entry type
  entry_type: model.enum([
    "DEPOSIT",
    "WITHDRAWAL",
    "TRANSFER",
    "PURCHASE",
    "INVESTMENT",
    "DIVIDEND",
    "COMMISSION",
    "SETTLEMENT",
    "REFUND",
    "ADJUSTMENT",
    "FEE",
    "CREATOR_COMMISSION",
    "CREATOR_REWARD",
  ]),
  
  // Status
  status: model.enum([
    "PENDING",
    "COMPLETED",
    "SETTLED",
    "FAILED",
    "REVERSED",
  ]).default("PENDING"),
  
  // Reference to external entities
  reference_type: model.enum([
    "ORDER",
    "PAYMENT",
    "SETTLEMENT_BATCH",
    "INVESTMENT_POOL",
    "STRIPE_PAYMENT",
    "STELLAR_TX",
    "MANUAL",
    "CREATOR_ATTRIBUTION",
    "CREATOR_REWARD_POOL",
    "SPONSORSHIP",
  ]).nullable(),
  reference_id: model.text().nullable(),
  
  // For order-related entries
  order_id: model.text().nullable(),
  
  // For investment entries
  investment_pool_id: model.text().nullable(),
  
  // Running balances after this entry (for audit)
  debit_balance_after: model.bigNumber().nullable(),
  credit_balance_after: model.bigNumber().nullable(),
  
  // Description for audit trail
  description: model.text().nullable(),
  
  // Idempotency key to prevent duplicate entries
  idempotency_key: model.text().unique().nullable(),
  
  // Metadata
  metadata: model.json().nullable(),
  
  // For settlement batching
  settlement_batch_id: model.text().nullable(),
  settled_at: model.dateTime().nullable(),
})
  // OPTIMIZATION: Add indexes for common query patterns
  .indexes([
    // Index for fetching entries by debit account (getTransactionHistory)
    {
      on: ["debit_account_id", "created_at"],
      name: "idx_ledger_entry_debit_account",
    },
    // Index for fetching entries by credit account (getTransactionHistory)
    {
      on: ["credit_account_id", "created_at"],
      name: "idx_ledger_entry_credit_account",
    },
    // Index for order-related queries (processRefund, etc.)
    {
      on: ["order_id", "status"],
      name: "idx_ledger_entry_order",
    },
    // Index for pending entries (dashboard queries)
    {
      on: ["status", "credit_account_id"],
      name: "idx_ledger_entry_status_credit",
    },
    // Index for entry type filtering
    {
      on: ["entry_type", "status"],
      name: "idx_ledger_entry_type_status",
    },
    // Index for investment pool queries
    {
      on: ["investment_pool_id"],
      name: "idx_ledger_entry_pool",
    },
  ])
