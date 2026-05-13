import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20251229AddRawColumns extends Migration {
  override async up(): Promise<void> {
    // Add raw columns for BigNumber support in ledger_account
    this.addSql(`ALTER TABLE "hawala_ledger_account" ADD COLUMN IF NOT EXISTS "raw_balance" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" ADD COLUMN IF NOT EXISTS "raw_pending_balance" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" ADD COLUMN IF NOT EXISTS "raw_available_balance" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" ADD COLUMN IF NOT EXISTS "raw_investment_target" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" ADD COLUMN IF NOT EXISTS "raw_investment_raised" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" ADD COLUMN IF NOT EXISTS "investment_target" NUMERIC(20,4);`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" ADD COLUMN IF NOT EXISTS "investment_raised" NUMERIC(20,4) DEFAULT 0;`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" ADD COLUMN IF NOT EXISTS "investment_roi_rate" REAL;`)

    // Add raw columns for ledger_entry
    this.addSql(`ALTER TABLE "hawala_ledger_entry" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB;`)

    // Add raw columns for settlement_batch
    this.addSql(`ALTER TABLE "hawala_settlement_batch" ADD COLUMN IF NOT EXISTS "raw_total_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_settlement_batch" ADD COLUMN IF NOT EXISTS "raw_fee_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_settlement_batch" ADD COLUMN IF NOT EXISTS "raw_net_amount" JSONB;`)

    // Add raw columns for investment_pool
    this.addSql(`ALTER TABLE "hawala_investment_pool" ADD COLUMN IF NOT EXISTS "raw_target_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_investment_pool" ADD COLUMN IF NOT EXISTS "raw_current_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_investment_pool" ADD COLUMN IF NOT EXISTS "raw_min_investment" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_investment_pool" ADD COLUMN IF NOT EXISTS "raw_max_investment" JSONB;`)

    // Add raw columns for investment
    this.addSql(`ALTER TABLE "hawala_investment" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_investment" ADD COLUMN IF NOT EXISTS "raw_return_amount" JSONB;`)

    // Add raw columns for vendor_advance
    this.addSql(`ALTER TABLE "hawala_vendor_advance" ADD COLUMN IF NOT EXISTS "raw_principal_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" ADD COLUMN IF NOT EXISTS "raw_total_repayment" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" ADD COLUMN IF NOT EXISTS "raw_outstanding_balance" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_vendor_advance" ADD COLUMN IF NOT EXISTS "raw_total_repaid" JSONB;`)

    // Add raw columns for advance_repayment
    this.addSql(`ALTER TABLE "hawala_advance_repayment" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB;`)

    // Add raw columns for payout_config
    this.addSql(`ALTER TABLE "hawala_payout_config" ADD COLUMN IF NOT EXISTS "raw_minimum_payout" JSONB;`)

    // Add raw columns for payout_split_rule
    this.addSql(`ALTER TABLE "hawala_payout_split_rule" ADD COLUMN IF NOT EXISTS "raw_fixed_amount" JSONB;`)

    // Add raw columns for payout_request
    this.addSql(`ALTER TABLE "hawala_payout_request" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_payout_request" ADD COLUMN IF NOT EXISTS "raw_fee_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_payout_request" ADD COLUMN IF NOT EXISTS "raw_net_amount" JSONB;`)

    // Add raw columns for chargeback_protection
    this.addSql(`ALTER TABLE "hawala_chargeback_protection" ADD COLUMN IF NOT EXISTS "raw_coverage_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_chargeback_protection" ADD COLUMN IF NOT EXISTS "raw_deductible" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_chargeback_protection" ADD COLUMN IF NOT EXISTS "raw_claims_total" JSONB;`)

    // Add raw columns for chargeback_claim
    this.addSql(`ALTER TABLE "hawala_chargeback_claim" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_chargeback_claim" ADD COLUMN IF NOT EXISTS "raw_covered_amount" JSONB;`)

    // Add raw columns for vendor_payment
    this.addSql(`ALTER TABLE "hawala_vendor_payment" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_vendor_payment" ADD COLUMN IF NOT EXISTS "raw_fee_amount" JSONB;`)

    // Add raw columns for vendor_credit_line
    this.addSql(`ALTER TABLE "hawala_vendor_credit_line" ADD COLUMN IF NOT EXISTS "raw_credit_limit" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_vendor_credit_line" ADD COLUMN IF NOT EXISTS "raw_available_credit" JSONB;`)
    this.addSql(`ALTER TABLE "hawala_vendor_credit_line" ADD COLUMN IF NOT EXISTS "raw_current_balance" JSONB;`)

    // Add raw columns for credit_line_transaction
    this.addSql(`ALTER TABLE "hawala_credit_line_transaction" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB;`)

    // Add raw columns for ach_transaction
    this.addSql(`ALTER TABLE "hawala_ach_transaction" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB;`)
  }

  override async down(): Promise<void> {
    // Remove raw columns (optional - usually you wouldn't remove these)
    this.addSql(`ALTER TABLE "hawala_ledger_account" DROP COLUMN IF EXISTS "raw_balance";`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" DROP COLUMN IF EXISTS "raw_pending_balance";`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" DROP COLUMN IF EXISTS "raw_available_balance";`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" DROP COLUMN IF EXISTS "raw_investment_target";`)
    this.addSql(`ALTER TABLE "hawala_ledger_account" DROP COLUMN IF EXISTS "raw_investment_raised";`)
  }
}
