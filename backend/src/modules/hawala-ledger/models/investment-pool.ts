import { model } from "@medusajs/framework/utils"

/**
 * Investment Pool
 * Producer-specific investment pools where customers can micro-invest
 * 
 * Features:
 * - Automatic micro-investment from purchases (optional)
 * - Producer revenue sharing with investors
 * - Seasonal funding for farm operations
 */
export const InvestmentPool = model.define("hawala_investment_pool", {
  id: model.id().primaryKey(),
  
  // Pool identification
  name: model.text(),
  description: model.text().nullable(),
  
  // Producer reference
  producer_id: model.text(), // Links to producer module
  
  // Linked ledger account (PRODUCER_POOL type). A CARRIED pool keeps its
  // account at zero: `createTransfer` refuses every leg that names a pool or a
  // pool account (service.ts `assertPoolLegAllowed_`), so the row is dormant.
  ledger_account_id: model.text(),

  // Nonprofit carrier (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b; legal
  // checkpoints L26, L11). The verified partner_org that holds and administers
  // this pool's funds ON ITS OWN ACCOUNTS. `carrier_org_key` points at
  // `partner_org.key` by key, like `fiscal_host_key`; `carrier_snapshot` is the
  // frozen `PoolCarrierSnapshot` (../carrier.ts) the admin route built from the
  // directory at assignment time, dated by the IRS file (L11). Written only by
  // `assignPoolCarrier`; the generated create/update strip both fields.
  carrier_org_key: model.text().nullable(),
  carrier_snapshot: model.json().nullable(),
  
  // Investment terms
  target_amount: model.bigNumber(), // Target raise amount
  minimum_investment: model.bigNumber().default(1), // Min per investor
  maximum_investment: model.bigNumber().nullable(), // Max per investor
  
  // ROI structure
  roi_type: model.enum([
    "FIXED_RATE",       // Fixed percentage return
    "REVENUE_SHARE",    // Share of producer revenue
    "PRODUCT_CREDIT",   // Returns as store credit
    "HYBRID",           // Combination
  ]).default("REVENUE_SHARE"),
  roi_rate: model.float().nullable(), // For FIXED_RATE: annual percentage
  fixed_roi_rate: model.float().nullable(), // Fixed ROI rate alias
  revenue_share_percentage: model.float().nullable(), // For REVENUE_SHARE
  product_credit_multiplier: model.float().nullable(), // For PRODUCT_CREDIT
  
  // Timeline
  start_date: model.dateTime().nullable(), // Pool start date
  end_date: model.dateTime().nullable(), // Pool end date
  fundraising_start: model.dateTime().nullable(),
  fundraising_end: model.dateTime().nullable(),
  maturity_date: model.dateTime().nullable(), // When investments mature
  
  // Progress tracking
  total_raised: model.bigNumber().default(0),
  total_investors: model.number().default(0),
  total_distributed: model.bigNumber().default(0), // Total ROI distributed
  
  // Status
  status: model.enum([
    "DRAFT",
    "FUNDRAISING",
    "FUNDED",
    "ACTIVE",       // Generating returns
    "DISTRIBUTING", // Paying out returns
    "COMPLETED",
    "CANCELLED",
  ]).default("DRAFT"),
  
  // Auto-investment settings
  auto_invest_enabled: model.boolean().default(false),
  auto_invest_percentage: model.float().nullable(), // % of order to invest
  
  // Photo/media
  cover_image: model.text().nullable(),
  
  // Metadata
  metadata: model.json().nullable(),
})
  // OPTIMIZATION: Add indexes for common query patterns
  .indexes([
    // Index for vendor pool lookups
    {
      on: ["producer_id", "status"],
      name: "idx_investment_pool_producer",
    },
    // Index for ledger account lookups
    {
      on: ["ledger_account_id"],
      name: "idx_investment_pool_account",
    },
    // Carried-pool lookups by org
    {
      on: ["carrier_org_key"],
      name: "IDX_hawala_investment_pool_carrier_org_key",
      where: "deleted_at IS NULL",
    },
  ])

/**
 * Investment Record
 * Individual investment by a customer into a pool
 */
export const Investment = model.define("hawala_investment", {
  id: model.id().primaryKey(),
  
  // References
  pool_id: model.text(), // Investment pool
  // Investor's ledger account. Null on a CARRIER-settled row: the money never
  // touched a BMC account.
  investor_account_id: model.text().nullable(),
  customer_id: model.text().nullable(), // Customer who invested

  // How this row settled. LEDGER: the historical shape — a USER_WALLET →
  // PRODUCER_POOL transfer, `ledger_entry_id` set. CARRIER: a RECORD of a
  // contribution the pool's nonprofit carrier received on its own accounts
  // (`recordCarrierContribution`); no ledger leg, no account, idempotent by
  // the carrier's own reference under a partial unique index on
  // (pool_id, carrier_reference). No new entry_type or reference_type: the
  // discriminator lives here, not on hawala_ledger_entry.
  settlement: model.enum(["LEDGER", "CARRIER"]).default("LEDGER"),
  carrier_org_key: model.text().nullable(),
  carrier_reference: model.text().nullable(),
  
  // Investment details
  amount: model.bigNumber(),
  currency_code: model.text().default("USD"),
  
  // Returns tracking
  expected_return: model.bigNumber().nullable(),
  actual_return: model.bigNumber().default(0),
  return_distributed: model.bigNumber().default(0),
  
  // Status
  status: model.enum([
    "PENDING",
    "CONFIRMED",
    "EARNING",
    "MATURED",
    "WITHDRAWN",
    "CANCELLED",
  ]).default("PENDING"),
  
  // Source
  source: model.enum([
    "DIRECT",         // Direct investment
    "AUTO_ORDER",     // Auto-invest from order
    "GIFT",           // Gifted investment
  ]).default("DIRECT"),
  source_order_id: model.text().nullable(),
  
  // Ledger entry reference
  ledger_entry_id: model.text().nullable(),
  
  // Metadata
  metadata: model.json().nullable(),
  
  invested_at: model.dateTime(),
  matured_at: model.dateTime().nullable(),
  withdrawn_at: model.dateTime().nullable(),
})
  // OPTIMIZATION: Add indexes for common query patterns
  .indexes([
    // Index for pool investment lookups
    {
      on: ["pool_id", "status"],
      name: "idx_investment_pool_status",
    },
    // Index for customer investments
    {
      on: ["customer_id"],
      name: "idx_investment_customer",
    },
    // Index for investor account lookups
    {
      on: ["investor_account_id"],
      name: "idx_investment_account",
    },
    // One record per carrier reference per pool: the idempotency key for
    // carried contributions. Partial so LEDGER rows (null reference) are free.
    {
      on: ["pool_id", "carrier_reference"],
      name: "UQ_hawala_investment_pool_carrier_reference",
      unique: true,
      where: "deleted_at IS NULL AND carrier_reference IS NOT NULL",
    },
  ])
