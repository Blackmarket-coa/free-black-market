import { z } from "zod"

/**
 * Hawala Financial Module - Input Validation Schemas
 * 
 * SECURITY: All financial inputs MUST be validated using these schemas
 * to prevent type coercion, negative amounts, and injection attacks.
 */

// =============================================================================
// Common Validators
// =============================================================================

/** Safe positive amount validator with reasonable limits */
export const amountSchema = z.number()
  .positive("Amount must be positive")
  .max(1_000_000, "Amount exceeds maximum limit")

/** Safe pagination validator */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/** UUID/ID validator */
export const idSchema = z.string().min(1).max(100)

// =============================================================================
// Investment Pool Schemas
// =============================================================================

export const roiTypeSchema = z.enum([
  "FIXED_RATE",
  "REVENUE_SHARE", 
  "PRODUCT_CREDIT",
  "HYBRID",
])

export const poolStatusSchema = z.enum([
  "DRAFT",
  "FUNDRAISING",
  "FUNDED",
  "ACTIVE",
  "DISTRIBUTING",
  "COMPLETED",
  "CANCELLED",
])

export const createPoolSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  target_amount: amountSchema,
  minimum_investment: amountSchema.optional().default(1),
  roi_type: roiTypeSchema,
  fixed_roi_rate: z.number().min(0).max(100).optional(),
  revenue_share_percentage: z.number().min(0).max(100).optional(),
  product_credit_multiplier: z.number().min(0).max(10).optional(),
  end_date: z.string().datetime().optional(),
  auto_invest_enabled: z.boolean().optional().default(false),
  auto_invest_percentage: z.number().min(0).max(100).optional().default(0),
})

export const updatePoolSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: poolStatusSchema.optional(),
  target_amount: amountSchema.optional(),
  auto_invest_enabled: z.boolean().optional(),
  auto_invest_percentage: z.number().min(0).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const withdrawPoolSchema = z.object({
  amount: amountSchema,
  description: z.string().max(500).optional(),
})

export const distributeDividendsSchema = z.object({
  amount: amountSchema,
  distribution_type: z.enum(["PROPORTIONAL", "EQUAL"]).optional().default("PROPORTIONAL"),
})

// =============================================================================
// Advance Schemas
// =============================================================================

export const requestAdvanceSchema = z.object({
  amount: amountSchema.refine(val => val >= 50, "Minimum advance is $50"),
  fee_rate: z.number().min(1).max(2).optional().default(1.05),
  term_days: z.number().int().min(7).max(365).optional().default(30),
  reason: z.string().max(500).optional(),
})

export const advanceStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "ACTIVE",
  "REPAID",
  "DEFAULTED",
])

export const updateAdvanceStatusSchema = z.object({
  status: advanceStatusSchema,
  notes: z.string().max(500).optional(),
})

// =============================================================================
// Payout Schemas
// =============================================================================

export const payoutTierSchema = z.enum([
  "INSTANT",
  "SAME_DAY",
  "NEXT_DAY",
  "WEEKLY",
])

export const updatePayoutConfigSchema = z.object({
  default_payout_tier: payoutTierSchema.optional(),
  auto_payout_enabled: z.boolean().optional(),
  payout_threshold: amountSchema.optional(),
  split_rules: z.array(z.object({
    name: z.string().min(1).max(100),
    percentage: z.number().min(0).max(100),
    destination_type: z.enum(["BANK", "WALLET", "REINVEST"]),
    destination_id: z.string().optional(),
  })).max(10).optional(),
})

export const requestPayoutSchema = z.object({
  amount: amountSchema.optional(), // If not provided, payout full available balance
  payout_tier: payoutTierSchema.optional(),
  destination_bank_account_id: idSchema.optional(),
})

// =============================================================================
// Transfer Schemas
// =============================================================================

export const createTransferSchema = z.object({
  debit_account_id: idSchema,
  credit_account_id: idSchema,
  amount: amountSchema,
  entry_type: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
})

// =============================================================================
// Bank Account Schemas
// =============================================================================

export const linkBankAccountSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  return_url: z.string().url(),
  method: z.enum(["financial_connections", "manual"]).optional(),
})

export const completeBankLinkSchema = z.object({
  stripe_customer_id: z.string().min(1),
  financial_connections_account_id: z.string().min(1),
})

export const manualBankAccountSchema = z.object({
  stripe_customer_id: z.string().min(1),
  routing_number: z.string().length(9).regex(/^\d+$/, "Routing number must be 9 digits"),
  account_number: z.string().min(4).max(17).regex(/^\d+$/, "Account number must be numeric"),
  account_holder_name: z.string().min(1).max(200),
  account_type: z.enum(["checking", "savings"]),
})

// =============================================================================
// ACH Transaction Schemas
// =============================================================================

export const initiateDepositSchema = z.object({
  bank_account_id: idSchema,
  amount: amountSchema.refine(val => val >= 1, "Minimum deposit is $1"),
})

export const initiateWithdrawalSchema = z.object({
  bank_account_id: idSchema,
  amount: amountSchema.refine(val => val >= 1, "Minimum withdrawal is $1"),
})

// =============================================================================
// Investment Schemas
// =============================================================================

export const createInvestmentSchema = z.object({
  pool_id: idSchema,
  amount: amountSchema,
})

// =============================================================================
// Vendor Payment Schemas
// =============================================================================

export const createVendorPaymentSchema = z.object({
  payee_vendor_id: idSchema,
  amount: amountSchema,
  payment_type: z.enum(["GOODS", "SERVICES", "LOAN", "OTHER"]).optional().default("OTHER"),
  invoice_number: z.string().max(100).optional(),
  reference_note: z.string().max(500).optional(),
})

// =============================================================================
// Account Schemas
// =============================================================================

export const accountTypeSchema = z.enum([
  "USER_WALLET",
  "SELLER_EARNINGS",
  "PRODUCER_POOL",
  "PLATFORM_FEES",
  "RESERVE",
  "ESCROW",
])

export const ownerTypeSchema = z.enum([
  "CUSTOMER",
  "SELLER",
  "PRODUCER",
  "PLATFORM",
])

export const createAccountSchema = z.object({
  account_type: accountTypeSchema,
  owner_type: ownerTypeSchema,
  owner_id: idSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const updateAccountSchema = z.object({
  status: z.enum(["ACTIVE", "FROZEN", "CLOSED"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// =============================================================================
// Settlement Schemas
// =============================================================================

export const createSettlementSchema = z.object({
  period_start: z.string().datetime().optional(),
  period_end: z.string().datetime().optional(),
})

// =============================================================================
// Helper: Safe Parse with Error Response
// =============================================================================

export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const errorMessages = result.error.issues
    .map(e => `${e.path.join(".")}: ${e.message}`)
    .join(", ")
  return { success: false, error: errorMessages }
}

// =============================================================================
// Safe Pagination Helper
// =============================================================================

/**
 * Safely parse pagination parameters with bounds checking
 * 
 * SECURITY: Prevents NaN injection, negative values, and memory issues
 * from overly large limits.
 */
export function safePagination(
  limit: string | undefined,
  offset: string | undefined,
  maxLimit: number = 100,
  defaultLimit: number = 50
): { limit: number; offset: number } {
  const parsedLimit = parseInt(limit || String(defaultLimit), 10)
  const parsedOffset = parseInt(offset || "0", 10)

  return {
    limit: Math.min(Math.max(isNaN(parsedLimit) ? defaultLimit : parsedLimit, 1), maxLimit),
    offset: Math.max(isNaN(parsedOffset) ? 0 : parsedOffset, 0),
  }
}
