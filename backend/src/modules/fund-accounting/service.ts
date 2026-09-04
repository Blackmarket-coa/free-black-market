import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import { Fund, FundTransaction } from "./models"
import { FundRestriction, FundStatus } from "./models/fund"
import { FundEntryType } from "./models/fund-transaction"
import {
  SETTLEMENT_REFERENCE_TYPE,
  checkCompliance,
  hasSettlementCitation,
  isWithinSpendPeriod,
  rollupFund,
  spendHeadroomCents,
  type FundRollup,
  type FundViolation,
} from "./fund-math"

/**
 * What the caller learned about the settlement an expenditure cites. Produced
 * by a `SettlementVerifier` the route composes from the hawala ledger; this
 * module never resolves the ledger itself.
 */
export interface VerifiedSettlement {
  id: string
  /** Integer cents the settlement moved out of the seller's account. */
  amount_cents: number
  currency_code: string
  /** True only when the money has actually moved (COMPLETED / SETTLED). */
  settled: boolean
}

/**
 * Looks up a settlement the current seller owns. Returns null both when the
 * id does not exist and when it belongs to someone else, so the guard never
 * confirms another seller's ledger rows.
 */
export type SettlementVerifier = (
  referenceId: string
) => Promise<VerifiedSettlement | null>

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
   *
   * Does NOT bypass the settlement citation or the per-settlement cap. Those
   * are conservation — money cannot be attributed that did not move — not
   * policy, and there is no documented exception to conservation.
   */
  force?: boolean
}

export interface RecordEntryDeps {
  verifySettlement?: SettlementVerifier
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
 *
 * An expenditure is a claim that grant money paid for something. The claim is
 * only auditable if it points at the settlement that actually moved the money,
 * so every non-zero expenditure must cite a `hawala_ledger_entry`, and across
 * all of a seller's funds the cents attributed to one settlement can never
 * exceed what it moved. A $1,000 payment may be split $600/$400 between two
 * grants; it may never be claimed as $600 by one and $500 by another.
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
   * Net cents this seller has already attributed to one settlement, across
   * every fund. Reversing entries (negative) reduce it.
   */
  async getCitedCents(sellerId: string, referenceId: string): Promise<number> {
    const rows = await this.listFundTransactions({
      seller_id: sellerId,
      entry_type: FundEntryType.EXPENDITURE,
      reference_type: SETTLEMENT_REFERENCE_TYPE,
      reference_id: referenceId,
    })
    return rows.reduce((sum, r) => sum + Math.round(Number(r.amount_cents ?? 0)), 0)
  }

  /** Same figure for many settlements at once, for a picker. */
  async getCitedCentsBySettlement(
    sellerId: string,
    referenceIds: string[]
  ): Promise<Record<string, number>> {
    const cited: Record<string, number> = {}
    for (const id of referenceIds) cited[id] = 0
    if (referenceIds.length === 0) return cited

    const rows = await this.listFundTransactions({
      seller_id: sellerId,
      entry_type: FundEntryType.EXPENDITURE,
      reference_type: SETTLEMENT_REFERENCE_TYPE,
      reference_id: referenceIds,
    })
    for (const r of rows) {
      const id = r.reference_id as string
      cited[id] = (cited[id] ?? 0) + Math.round(Number(r.amount_cents ?? 0))
    }
    return cited
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
   *
   * Before any of that, a non-zero expenditure must cite the settlement that
   * moved the money, and the citation must survive `deps.verifySettlement`.
   * Structural checks (does the money exist, did it move, is it this seller's)
   * run before policy checks (is it within the award, within the period), so a
   * refusal always names the most fundamental problem first.
   */
  async recordEntry(input: RecordEntryInput, deps: RecordEntryDeps = {}) {
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

    if (input.entry_type === FundEntryType.EXPENDITURE && amount_cents !== 0) {
      await this.assertSettlementCited(input, fund, amount_cents, deps)
    }

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

  /**
   * Throws unless the expenditure cites a settlement this seller owns, the
   * money has actually moved, the currency matches, and the seller's total
   * attribution against that settlement — across every fund — stays within
   * what it moved. Never bypassed by `force`.
   */
  private async assertSettlementCited(
    input: RecordEntryInput,
    fund: { currency_code?: string | null },
    amountCents: number,
    deps: RecordEntryDeps
  ): Promise<void> {
    if (!hasSettlementCitation(input)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `An expenditure must cite the settlement that moved the money (reference_type "${SETTLEMENT_REFERENCE_TYPE}" and reference_id)`
      )
    }
    const referenceId = input.reference_id as string

    // Fail closed: a spend that cannot be verified is not recorded.
    if (!deps.verifySettlement) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Settlement verification is unavailable; the expenditure cannot be recorded"
      )
    }

    const settlement = await deps.verifySettlement(referenceId)
    if (!settlement) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Settlement not found")
    }
    if (!settlement.settled) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Settlement has not completed; the money has not moved yet"
      )
    }

    const fundCurrency = (fund.currency_code ?? "usd").toLowerCase()
    if ((settlement.currency_code ?? "").toLowerCase() !== fundCurrency) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Settlement is in ${settlement.currency_code}; the fund is in ${fundCurrency}`
      )
    }

    const cited = await this.getCitedCents(input.seller_id, referenceId)
    const after = cited + amountCents

    if (amountCents > 0 && after > settlement.amount_cents) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Expenditure of ${amountCents} cents exceeds the settlement: ${settlement.amount_cents} cents moved, ${cited} cents already attributed across your funds`
      )
    }
    if (amountCents < 0 && after < 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Reversal of ${-amountCents} cents reverses more than the ${cited} cents attributed to this settlement`
      )
    }
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
