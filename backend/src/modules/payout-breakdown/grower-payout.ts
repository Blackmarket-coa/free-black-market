/**
 * Plant Network — Grower-NODE payout attribution (Section 2).
 *
 * Built ON TOP of the existing ledger payout stack — it does NOT re-credit
 * sellers. `subscribers/hawala-order-payment.ts` already credits each product's
 * owning seller (SELLER_EARNINGS, net of platform fee). For multi-node sales the
 * coop hub takes a share of each node's net; this service moves only that **hub
 * cut** from the grower's seller-earnings account to the hub account, on the USD
 * rail. Grower keeps `GROWER_SPLIT_CONFIG[node]`; hub gets the remainder.
 *
 * Confirmed design: grower_node is a label; the real payee is the product's
 * `seller_id`. Splits/history/1099 therefore key off seller_id.
 *
 * SAFETY: the hub-split transfer is idempotent (per line item) and balance-
 * guarded — if the base seller credit hasn't settled yet, the split is deferred
 * (status "pending") rather than throwing, so this never destabilises the money
 * path. Actual bank/ACH settlement (processMonthlyPayouts) is the one external
 * SEAM.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../hawala-ledger"
import { resolveSellerPlatformFeePercent } from "../../shared/platform-fee"
import type { GrowerNode } from "../../types/plant"
import {
  loadOrderNodeContext,
  centsToDollars,
  type OrderNodeItem,
} from "../agriculture/plant-order-helpers"

/**
 * Grower's share of post-platform-fee net. `hub_sc` keeps 100% (it IS the hub).
 * Mirrors the tier ladder in `progression/grower-karma.ts`.
 */
export const GROWER_SPLIT_CONFIG: Record<GrowerNode, number> = {
  hub_sc: 1.0,
  node_ga: 0.6,
  node_fl: 0.6,
  node_nc_mtn: 0.62,
  node_nc_pied: 0.6,
  node_va: 0.6,
  node_md: 0.6,
  node_ny: 0.6,
}

/** Fallback platform fee fraction if payout-breakdown can't supply one. */
export const PLATFORM_FEE = 0.05

/** Owner id of the system account that receives hub cuts. */
const HUB_ACCOUNT_OWNER = "hub_sc"

export interface NodeSplit {
  grossDollars: number
  platformFee: number
  net: number
  growerAmount: number
  hubAmount: number
}

/**
 * Pure node-split math (no I/O). gross (cents) → platform fee → net → grower /
 * hub amounts in dollars, hub amount rounded to cents. Extracted for testing.
 */
export function computeNodeSplit(
  grossCents: number,
  platformFeeFraction: number,
  growerSplit: number
): NodeSplit {
  const grossDollars = grossCents / 100
  const platformFee = grossDollars * platformFeeFraction
  const net = grossDollars - platformFee
  const growerAmount = net * growerSplit
  const hubAmount = Math.round((net - growerAmount) * 100) / 100
  return { grossDollars, platformFee, net, growerAmount, hubAmount }
}

export type GrowerPayoutStatus = "transferred" | "pending" | "skipped"

export interface GrowerPayoutEvent {
  order_id: string
  line_item_id: string
  grower_node: GrowerNode | null
  seller_id: string | null
  gross_amount: number // dollars
  platform_fee: number
  net_after_fee: number
  grower_amount: number
  hub_amount: number
  rail: "USD"
  status: GrowerPayoutStatus
  reason?: string
}

type HawalaService = {
  getOrCreateSellerEarnings: (sellerId: string, currency?: string) => Promise<any>
  listLedgerAccounts: (filters: Record<string, unknown>) => Promise<any[]>
  createAccount: (data: Record<string, unknown>) => Promise<any>
  createTransfer: (data: Record<string, unknown>) => Promise<any>
  listLedgerEntries: (filters: Record<string, unknown>) => Promise<any[]>
  getAccountBalance: (id: string) => Promise<{ available_balance: number }>
  requestPayout: (data: {
    vendor_id: string
    amount: number
    payout_tier: "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY"
    bank_account_id?: string
  }) => Promise<{ id: string; status?: string }>
}

export class GrowerPayoutService {
  private readonly container: MedusaContainer
  private feeCache = new Map<string, number>()

  constructor(container: MedusaContainer) {
    this.container = container
  }

  private get hawala(): HawalaService {
    return this.container.resolve(HAWALA_LEDGER_MODULE) as unknown as HawalaService
  }

  /**
   * Fractional platform fee for a seller (e.g. 0.05), cached per run.
   *
   * Goes through `resolveSellerPlatformFeePercent` so the seller's billing plan
   * sits in the chain between their negotiated override and the platform
   * default — calling the payout service directly would settle a grower payout
   * at a different rate than the order that produced it.
   */
  private async platformFeeFraction(sellerId: string): Promise<number> {
    if (this.feeCache.has(sellerId)) return this.feeCache.get(sellerId)!
    let fraction = PLATFORM_FEE
    try {
      const pct = await resolveSellerPlatformFeePercent(this.container, sellerId)
      if (Number.isFinite(pct) && pct >= 0) fraction = pct / 100
    } catch {
      // fall back to default
    }
    this.feeCache.set(sellerId, fraction)
    return fraction
  }

  /** Get-or-create the hub account that receives node hub-cuts (USD). */
  private async getHubAccount() {
    const existing = await this.hawala.listLedgerAccounts({
      account_type: "PRODUCER_POOL",
      owner_type: "SYSTEM",
      owner_id: HUB_ACCOUNT_OWNER,
    })
    if (existing.length > 0) return existing[0]
    return this.hawala.createAccount({
      account_type: "PRODUCER_POOL",
      owner_type: "SYSTEM",
      owner_id: HUB_ACCOUNT_OWNER,
      currency_code: "USD",
    })
  }

  private async computeEvent(
    orderId: string,
    item: OrderNodeItem
  ): Promise<GrowerPayoutEvent> {
    const grossDollars = centsToDollars(item.gross_cents)
    const base: GrowerPayoutEvent = {
      order_id: orderId,
      line_item_id: item.line_item_id,
      grower_node: item.grower_node,
      seller_id: item.seller_id,
      gross_amount: grossDollars,
      platform_fee: 0,
      net_after_fee: grossDollars,
      grower_amount: grossDollars,
      hub_amount: 0,
      rail: "USD",
      status: "skipped",
    }

    // Hub's own production, unknown node, or no seller → no inter-node split.
    if (!item.seller_id || !item.grower_node || item.grower_node === "hub_sc") {
      base.reason = "no_split_required"
      return base
    }

    const feeFraction = await this.platformFeeFraction(item.seller_id)
    const split = GROWER_SPLIT_CONFIG[item.grower_node] ?? 0.6
    const { platformFee, net, growerAmount, hubAmount } = computeNodeSplit(
      item.gross_cents,
      feeFraction,
      split
    )

    base.platform_fee = platformFee
    base.net_after_fee = net
    base.grower_amount = growerAmount
    base.hub_amount = hubAmount

    if (hubAmount <= 0) {
      base.reason = "zero_hub_cut"
      return base
    }

    // Balance guard: only move money that has actually settled into the
    // grower's account, otherwise defer (the base credit may not be posted yet).
    const growerAccount = await this.hawala.getOrCreateSellerEarnings(item.seller_id, "USD")
    const balance = await this.hawala.getAccountBalance(growerAccount.id)
    if (Number(balance.available_balance) < hubAmount) {
      base.status = "pending"
      base.reason = "insufficient_balance_deferred"
      return base
    }

    const hubAccount = await this.getHubAccount()
    await this.hawala.createTransfer({
      debit_account_id: growerAccount.id,
      credit_account_id: hubAccount.id,
      amount: hubAmount,
      entry_type: "COMMISSION",
      reference_type: "ORDER",
      reference_id: item.line_item_id,
      order_id: orderId,
      idempotency_key: `grower-split:${orderId}:${item.line_item_id}`,
      description: `Hub coop cut on ${item.grower_node} sale (order ${orderId})`,
      metadata: {
        grower_node: item.grower_node,
        grower_seller_id: item.seller_id,
        gross_cents: item.gross_cents,
        platform_fee_fraction: feeFraction,
        split_pct: split,
        hub_amount: hubAmount,
      },
    })

    base.status = "transferred"
    return base
  }

  /**
   * Compute + post the hub cut for every node line item in an order.
   * Idempotent and balance-guarded. Call AFTER the base seller payout.
   */
  async queuePayoutsForOrder(orderId: string): Promise<GrowerPayoutEvent[]> {
    const ctx = await loadOrderNodeContext(this.container, orderId)
    if (!ctx) return []
    const events: GrowerPayoutEvent[] = []
    for (const item of ctx.items) {
      events.push(await this.computeEvent(orderId, item))
    }
    return events
  }

  /**
   * Ledger history for a grower (their SELLER_EARNINGS USD account), filtered to
   * [from, to]. Returns credits (earnings) and debits (hub cuts) for the node.
   */
  async getGrowerPayoutHistory(
    sellerId: string,
    from: Date,
    to: Date
  ): Promise<
    Array<{
      id: string
      order_id: string | null
      entry_type: string
      direction: "credit" | "debit"
      amount: number
      created_at: Date
    }>
  > {
    const account = await this.hawala.getOrCreateSellerEarnings(sellerId, "USD")
    const [credits, debits] = await Promise.all([
      this.hawala.listLedgerEntries({ credit_account_id: account.id }),
      this.hawala.listLedgerEntries({ debit_account_id: account.id }),
    ])
    const inRange = (d: unknown) => {
      const t = new Date(d as string).getTime()
      return t >= from.getTime() && t <= to.getTime()
    }
    const rows = [
      ...credits.map((e) => ({ e, direction: "credit" as const })),
      ...debits.map((e) => ({ e, direction: "debit" as const })),
    ]
      .filter(({ e }) => inRange(e.created_at))
      .map(({ e, direction }) => ({
        id: e.id,
        order_id: e.order_id ?? null,
        entry_type: e.entry_type,
        direction,
        amount: Number(e.amount),
        created_at: new Date(e.created_at),
      }))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    return rows
  }

  /**
   * Monthly settlement. Aggregates each grower's net USD earnings for the period
   * and hands each to the EXISTING hawala payout pipeline via `requestPayout`,
   * which debits SELLER_EARNINGS → SETTLEMENT and creates a PayoutRequest. The
   * actual Stripe ACH push is performed downstream by the existing
   * StripeAchService pipeline (gated by Stripe credentials), so there is no new
   * external provider here.
   *
   * Balance-guarded + per-seller try/catch: a seller whose available balance is
   * below the computed net (e.g. funds not yet settled) is reported as deferred
   * rather than throwing.
   */
  async processMonthlyPayouts(
    sellerIds: string[],
    period: { from: Date; to: Date },
    payoutTier: "INSTANT" | "SAME_DAY" | "NEXT_DAY" | "WEEKLY" = "WEEKLY"
  ): Promise<
    Array<{
      seller_id: string
      amount: number
      currency: "USD"
      status: "requested" | "deferred"
      payout_request_id?: string
      reason?: string
    }>
  > {
    const results: Array<{
      seller_id: string
      amount: number
      currency: "USD"
      status: "requested" | "deferred"
      payout_request_id?: string
      reason?: string
    }> = []

    for (const sellerId of sellerIds) {
      const rows = await this.getGrowerPayoutHistory(sellerId, period.from, period.to)
      const net =
        Math.round(
          rows.reduce(
            (sum, r) => sum + (r.direction === "credit" ? r.amount : -r.amount),
            0
          ) * 100
        ) / 100
      if (net <= 0) continue

      try {
        const payout = await this.hawala.requestPayout({
          vendor_id: sellerId,
          amount: net,
          payout_tier: payoutTier,
        })
        results.push({
          seller_id: sellerId,
          amount: net,
          currency: "USD",
          status: "requested",
          payout_request_id: payout.id,
        })
      } catch (err) {
        // Insufficient balance / no account → defer rather than fail the run.
        results.push({
          seller_id: sellerId,
          amount: net,
          currency: "USD",
          status: "deferred",
          reason: err instanceof Error ? err.message : "payout_request_failed",
        })
      }
    }
    return results
  }

  /**
   * 1099-NEC data: growers whose net USD earnings in `year` reach the $600
   * reporting threshold.
   */
  async generate1099Report(
    sellerIds: string[],
    year: number
  ): Promise<Array<{ seller_id: string; annual_earnings: number; requires_1099: boolean }>> {
    const from = new Date(Date.UTC(year, 0, 1))
    const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59))
    const out: Array<{ seller_id: string; annual_earnings: number; requires_1099: boolean }> = []
    for (const sellerId of sellerIds) {
      const rows = await this.getGrowerPayoutHistory(sellerId, from, to)
      const net = rows.reduce(
        (sum, r) => sum + (r.direction === "credit" ? r.amount : -r.amount),
        0
      )
      const annual = Math.round(net * 100) / 100
      out.push({ seller_id: sellerId, annual_earnings: annual, requires_1099: annual >= 600 })
    }
    return out
  }
}
