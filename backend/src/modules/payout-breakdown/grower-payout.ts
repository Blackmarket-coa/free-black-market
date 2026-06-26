/**
 * Plant Network — Grower-NODE payout attribution (Section 2).
 *
 * IMPORTANT — this does NOT re-implement payouts. The repo already has a full
 * ledger-based payout stack:
 *   - `modules/payout-breakdown/service.ts`  → OrderPayoutBreakdown / PayoutConfig
 *       / SellerPayoutSettings, line-item fee math (platform fee, creator
 *       commission, plugin/referral splits, etc).
 *   - `modules/hawala-ledger`                → SELLER_EARNINGS / CREATOR_EARNINGS
 *       / PLATFORM_FEE accounts, settlement batches, and the cash-convertible
 *       **USD** rail (see `hawala-ledger/rails.ts`, RailCode "USD").
 *   - `subscribers/hawala-order-payment.ts`  → already fires on payment to write
 *       the breakdown + ledger credits.
 *
 * What is MISSING and what this stub adds: the existing splits are
 * seller/creator-scoped. The plant network needs a *grower-node* attribution
 * layer so that line items can be split to the node that produced them and
 * settled on the USD rail. The TODOs below are expected to DELEGATE to the
 * services above rather than duplicate them.
 */

import type { GrowerNode } from "../../types/plant"
import type { RailCode } from "../hawala-ledger/rails"

/**
 * Per-node grower revenue share of the post-fee net. Mirrors the tier
 * `split_pct` ladder in `progression/grower-karma.ts` (Seedling 0.60 →
 * Ancestor 0.72); these are the *baseline* shares before tier bumps.
 * `hub_sc` keeps 100% of its own production (no inter-node split).
 */
export const GROWER_SPLIT_CONFIG: Record<GrowerNode, number> = {
  hub_sc: 1.0,
  node_ga: 0.6,
  node_fl: 0.6,
  node_nc_mtn: 0.62, // bump for high-value medicinals
  node_nc_pied: 0.6,
  node_va: 0.6,
  node_md: 0.6,
  node_ny: 0.6,
}

/** Platform fee taken off gross before the node split. */
export const PLATFORM_FEE = 0.05

const USD_RAIL: RailCode = "USD"

export interface GrowerPayoutEvent {
  order_id: string
  line_item_id: string
  grower_node: GrowerNode
  gross_amount: number // dollars (line item total, cents→dollars)
  platform_fee: number
  net_after_fee: number
  grower_amount: number
  hub_amount: number
  rail: RailCode // always USD for cash payout
  status: "pending" | "paid" | "failed"
  created_at: Date
  paid_at?: Date
}

export class GrowerPayoutService {
  /**
   * TODO: Called from the existing order/payment flow (extend, do not replace,
   * `subscribers/hawala-order-payment.ts`).
   * For each line item, read `product.metadata.grower_node`, skip `hub_sc`,
   * compute the split, and record a pending USD-rail entry via the hawala-ledger
   * service (reuse `getOrCreateSellerEarnings`-style account resolution mapped to
   * the node's producer/seller). Persist the attribution alongside the existing
   * OrderPayoutBreakdown row rather than a parallel table.
   */
  async queuePayoutsForOrder(_orderId: string): Promise<GrowerPayoutEvent[]> {
    throw new Error("TODO: GrowerPayoutService.queuePayoutsForOrder not implemented")
  }

  /**
   * TODO: Monthly cron (add under `backend/src/jobs/`). Aggregate pending
   * USD-rail grower entries per node and settle via the existing hawala-ledger
   * SettlementBatch + Stripe ACH edge. Mark entries paid. Notify each grower via
   * the existing Blackout Matrix path (`subscribers/emit-blackout-*`).
   */
  async processMonthlyPayouts(): Promise<void> {
    throw new Error("TODO: GrowerPayoutService.processMonthlyPayouts not implemented")
  }

  /**
   * TODO: Payout history for one node, for the grower dashboard
   * (`api/vendor/farm/grower-dashboard`). Query the existing ledger entries
   * filtered by the node's account + USD rail.
   */
  async getGrowerPayoutHistory(
    _grower_node: GrowerNode,
    _from: Date,
    _to: Date
  ): Promise<GrowerPayoutEvent[]> {
    throw new Error("TODO: GrowerPayoutService.getGrowerPayoutHistory not implemented")
  }

  /**
   * TODO: 1099-NEC data for growers earning >= $600 in a calendar year.
   * Aggregate paid USD-rail entries per node for the year.
   */
  async generate1099Report(_year: number): Promise<
    Array<{ grower_node: GrowerNode; annual_earnings: number; requires_1099: boolean }>
  > {
    throw new Error("TODO: GrowerPayoutService.generate1099Report not implemented")
  }
}

export { USD_RAIL }
