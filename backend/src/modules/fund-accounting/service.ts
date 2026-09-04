import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import { Fund, FundTransaction } from "./models"
import { FundRestriction, FundStatus } from "./models/fund"
import { FundEntryType } from "./models/fund-transaction"
import {
  checkCompliance,
  isWithinSpendPeriod,
  rollupFund,
  spendHeadroomCents,
  type FundRollup,
  type FundViolation,
} from "./fund-math"

export interface RecordEntryInput {
  seller_id: string
  fund_id: string
  entry_type: FundEntryType
  amount_cents: number
  occurred_at?: Date | string
  description?: string | null
  program_id?: string | null
  reference_type?: string | null
  reference_id?: string | null
  metadata?: Record<string, unknown> | null
  /**
   * Bypass the spend-limit and period guards for this one entry. Recording a
   * known-bad row on purpose (a correction, a documented exception) stays
   * possible; doing it by accident does not.
   */
  force?: boolean
}

export interface FundReport {
  fund_id: string
  code: string
  name: string
  restriction: string
  currency_code: string
  rollup: FundRollup
  violations: FundViolation[]
  /** Null when the fund does not enforce a spend limit. */
  spend_headroom_cents: number | null
}

/**
 * Fund Accounting service.
 *
 * Tracks money held under donor intent — the question commission splits and
 * round-up donations do not answer: how much of an award is unspent, and was it
 * spent on what it was designated for, inside the period it was designated for?
 *
 * Balances are always derived from `fund_transaction` rows (see `fund-math.ts`);
 * nothing is cached on the fund, so a fund cannot disagree with its history.
 */
class FundAccountingModuleService extends MedusaService({
  Fund,
  FundTransaction,
}) {
  async listForSeller(sellerId: string) {
    return this.listFunds({ seller_id: sellerId })
  }

  async listEntries(sellerId: string, fundId: string) {
    return this.listFundTransactions({ seller_id: sellerId, fund_id: fundId })
  }

  /**
   * Records a movement against a fund.
   *
   * Expenditures are guarded up front rather than reported after the fact:
   * overspending restricted money and spending it outside its period are the
   * two findings that actually cost an organisation its grant, so by default
   * the write is refused instead of being written and flagged later. A fund can
   * opt out with `enforce_spend_limit: false`, and a single entry can opt out
   * with `force`.
   */
  async recordEntry(input: RecordEntryInput) {
    const fund = await this.retrieveFund(input.fund_id)
    if (!fund || fund.seller_id !== input.seller_id) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Fund not found")
    }

    const amount_cents = Math.round(input.amount_cents)
    if (!Number.isFinite(amount_cents)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "amount_cents must be a finite number"
      )
    }

    const occurred_at = input.occurred_at ? new Date(input.occurred_at) : new Date()

    if (
      input.entry_type === FundEntryType.EXPENDITURE &&
      amount_cents > 0 &&
      !input.force
    ) {
      await this.assertSpendAllowed(fund, amount_cents, occurred_at)
    }

    return this.createFundTransactions({
      seller_id: input.seller_id,
      fund_id: input.fund_id,
      entry_type: input.entry_type,
      amount_cents,
      currency_code: fund.currency_code ?? "usd",
      occurred_at,
      description: input.description ?? null,
      program_id: input.program_id ?? null,
      reference_type: input.reference_type ?? null,
      reference_id: input.reference_id ?? null,
      metadata: input.metadata ?? null,
    })
  }

  /** Throws when a proposed expenditure would break the fund's own terms. */
  private async assertSpendAllowed(
    fund: {
      id: string
      restriction: string
      enforce_spend_limit?: boolean | null
      spend_from?: Date | null
      spend_until?: Date | null
    },
    amountCents: number,
    occurredAt: Date
  ): Promise<void> {
    if (fund.restriction === FundRestriction.PERMANENT) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot spend the corpus of a permanently restricted fund"
      )
    }

    const entries = await this.listFundTransactions({ fund_id: fund.id })
    const rollup = rollupFund(entries)
    const headroom = spendHeadroomCents(fund, rollup)

    if (headroom !== null && amountCents > headroom) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Expenditure of ${amountCents} cents exceeds the fund's unspent award of ${headroom} cents`
      )
    }

    if (
      (fund.restriction === FundRestriction.TIME ||
        fund.restriction === FundRestriction.PURPOSE_AND_TIME) &&
      !isWithinSpendPeriod(fund, occurredAt)
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Expenditure falls outside the fund's permitted spend period"
      )
    }
  }

  /** Balances plus every way the fund's history breaks its donor's intent. */
  async getFundReport(sellerId: string, fundId: string): Promise<FundReport> {
    const fund = await this.retrieveFund(fundId)
    if (!fund || fund.seller_id !== sellerId) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Fund not found")
    }

    const entries = await this.listFundTransactions({ fund_id: fundId })
    const rollup = rollupFund(entries)

    return {
      fund_id: fund.id,
      code: fund.code,
      name: fund.name,
      restriction: fund.restriction,
      currency_code: fund.currency_code ?? "usd",
      rollup,
      violations: checkCompliance(fund, entries),
      spend_headroom_cents: spendHeadroomCents(fund, rollup),
    }
  }

  /** Every active fund's report, for a portfolio-level reconciliation view. */
  async getPortfolioReport(sellerId: string): Promise<FundReport[]> {
    const funds = await this.listFunds({ seller_id: sellerId })
    return Promise.all(
      funds.map((fund) => this.getFundReport(sellerId, fund.id))
    )
  }

  /** Closes a fund for reporting. Does not delete its history. */
  async closeFund(sellerId: string, fundId: string) {
    const fund = await this.retrieveFund(fundId)
    if (!fund || fund.seller_id !== sellerId) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Fund not found")
    }
    return this.updateFunds({ id: fundId, status: FundStatus.CLOSED })
  }
}

export default FundAccountingModuleService
