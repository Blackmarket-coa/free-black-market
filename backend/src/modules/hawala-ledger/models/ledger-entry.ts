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
    // Issuer-controlled CCR mint/burn (Posture A closed loop). These are the
    // platform-internal issuer operations recognized by ISSUER_ENTRY_TYPES in
    // posture-a-guard.ts: CREDIT_PAYOUT_MINT issues credits (e.g. creator
    // XP → CCR conversion), CREDIT_REFUND_BURN extinguishes them (closed-loop
    // redemption request — never a cash-out). See docs/POSTURE_A_COMPLIANCE.md.
    // No migration needed: the column is plain TEXT (see
    // Migration20251229CreateHawalaLedger), matching how CREATOR_COMMISSION /
    // CREATOR_REWARD were added enum-only.
    "CREDIT_PAYOUT_MINT",
    "CREDIT_REFUND_BURN",
    // The generic issuer pair. `ISSUER_ENTRY_TYPES` in posture-a-guard.ts has
    // blessed ISSUE/BURN since it was written, but the model never declared
    // them, so the guard permitted an entry type the model said could not
    // exist — the same drift `reference-type-parity.unit.spec.ts` exists to
    // catch, on the other enum. Declaring them does not create a caller:
    // nothing posts ISSUE or BURN yet, and funding the CCR issuer remains the
    // ops step `docs/CCR_HRS_IGNITION.md` calls chain link 1. This closes the
    // vocabulary gap so that work is a script, not a schema change.
    "ISSUE",
    "BURN",
  ]),
  
  // Status
  status: model.enum([
    "PENDING",
    "COMPLETED",
    "SETTLED",
    "FAILED",
    "REVERSED",
  ]).default("PENDING"),
  
  // Reference to external entities.
  //
  // This list must stay a superset of `PURCHASE_CONTEXT_REFERENCE_TYPES` and
  // `TIMEBANK_REFERENCE_TYPES` in posture-a-guard.ts, and of every literal real
  // callers post. Those vocabularies had drifted apart: the guard blessed
  // CART / REFUND / PAYOUT / ESCROW_FUND / ESCROW_RELEASE / SUBSCRIPTION_RENEWAL
  // while this enum said they could not exist, and live call sites posted five
  // more it had never heard of — DEMAND_BOUNTY (services/collective-hawala.ts),
  // PAYOUT_REQUEST / VENDOR_ADVANCE / VENDOR_PAYMENT (service.ts) and COMMISSION
  // (jobs/patronage-refund.ts). `reference-type-parity.unit.spec.ts` now fails
  // the build if they diverge again.
  //
  // No migration needed to add a value: the column is plain TEXT (see
  // Migration20251229CreateHawalaLedger), the same enum-only path
  // CREATOR_COMMISSION and CREDIT_PAYOUT_MINT took above.
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
    // Bounty escrow, milestone payout and escrow refund
    // (services/collective-hawala.ts).
    "DEMAND_BOUNTY",
    // Purchase contexts the Posture A guard already recognized.
    "CART",
    "REFUND",
    "PAYOUT",
    "ESCROW_FUND",
    "ESCROW_RELEASE",
    "SUBSCRIPTION_RENEWAL",
    // Posted by live call sites that predate this reconciliation.
    "PAYOUT_REQUEST",
    "VENDOR_ADVANCE",
    "VENDOR_PAYMENT",
    "COMMISSION",
    // Time-bank (HRS) rail. The guard requires every HRS entry to cite one of
    // these, so any real hours transfer writes one — see
    // TIMEBANK_REFERENCE_TYPES in posture-a-guard.ts.
    "TIMEBANK_LOAN",
    "TIMEBANK_RETURN",
    "TIMEBANK_REDISTRIBUTION",
    "TIMEBANK_OPEN_BALANCE",
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

  // Lineage: entries created by one economic action (an order split, a
  // payout's net+fee pair, a consignment split) share a correlation_id —
  // the shared idempotency-key prefix that fan-out sites already use,
  // made explicit and indexed. parent_entry_id points at the entry this
  // one derives from (e.g. a fee leg pointing at the purchase leg) when
  // a strict parent exists. Both are backfilled from the historical
  // idempotency-key suffix convention in
  // Migration20260829ExternalReconciliationMonitorsLineage.
  correlation_id: model.text().nullable(),
  parent_entry_id: model.text().nullable(),

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
    // Index for lineage queries (getOrderLineage / getEntryLineage)
    {
      on: ["correlation_id"],
      name: "idx_ledger_entry_correlation",
    },
  ])
