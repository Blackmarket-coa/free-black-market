import { model } from "@medusajs/framework/utils"

/**
 * Hawala Ledger Account
 * Represents a wallet/account in the double-entry ledger system
 * 
 * Account Types:
 * - USER_WALLET: Customer wallet for marketplace purchases
 * - PRODUCER_POOL: Investment pool for a specific producer
 * - SELLER_EARNINGS: Vendor/seller earnings account
 * - PLATFORM_FEE: Platform commission account
 * - SETTLEMENT: Pending settlement account
 * - RESERVE: System reserve account
 */
export const LedgerAccount = model.define("hawala_ledger_account", {
  id: model.id().primaryKey(),
  
  // Account identification
  account_number: model.text().unique(), // Unique account identifier
  account_type: model.enum([
    "USER_WALLET",
    "PRODUCER_POOL",
    "SELLER_EARNINGS",
    "PLATFORM_FEE",
    "SETTLEMENT",
    "RESERVE",
    "ESCROW",
    "CREATOR_EARNINGS",
    "CREATOR_REWARD_POOL",
  ]),
  
  // Currency (ISO 4217)
  currency_code: model.text().default("USD"),
  
  // Balance tracking (computed from entries, cached here)
  balance: model.bigNumber().default(0),
  pending_balance: model.bigNumber().default(0), // Pending settlements
  available_balance: model.bigNumber().default(0), // balance - pending
  
  // Owner references (polymorphic)
  owner_type: model.enum([
    "CUSTOMER",
    "SELLER",
    "PRODUCER",
    "PLATFORM",
    "SYSTEM",
    "CREATOR",
  ]).nullable(),
  owner_id: model.text().nullable(), // customer_id, seller_id, producer_id, etc.
  
  // For investment pools
  investment_target: model.bigNumber().nullable(), // Target investment amount
  investment_raised: model.bigNumber().default(0), // Amount raised
  investment_roi_rate: model.float().nullable(), // Expected ROI percentage
  
  // Status
  status: model.enum([
    "ACTIVE",
    "FROZEN",
    "CLOSED",
    "PENDING_VERIFICATION",
  ]).default("ACTIVE"),
  
  // Stellar blockchain reference
  stellar_address: model.text().nullable(), // Stellar public key if linked
  
  // Metadata
  metadata: model.json().nullable(),
})
  // OPTIMIZATION: Add indexes for common query patterns
  .indexes([
    // Index for vendor account lookups (most common query pattern)
    {
      on: ["owner_type", "owner_id", "account_type"],
      name: "idx_ledger_account_owner",
    },
    // Index for account type queries
    {
      on: ["account_type", "status"],
      name: "idx_ledger_account_type_status",
    },
  ])
