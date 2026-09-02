/**
 * Which sales FBM's commission applies to.
 *
 * **The rule: commission is for native sales.** FBM takes its platform fee on
 * a sale it actually processed — anything that went through FBM checkout,
 * whichever surface the buyer arrived from: the storefront, a `connect.js`
 * embed on the vendor's own site, in-person POS, vending, click-and-collect
 * pickup, or a subscription renewal. It takes nothing on a sale that happened
 * somewhere else and was merely recorded here.
 *
 * That second case is the one this file exists to protect. An order ingested
 * from Faire, Etsy or Amazon was captured, paid and priced by that marketplace,
 * which already took its own cut before the money reached the vendor
 * (`FeeType.CHANNEL_FEE`). FBM provided no checkout, carried no payment risk
 * and holds no funds. Charging a platform fee on top would be charging for
 * work FBM did not do, and would leave the vendor paying two commissions on
 * one sale.
 *
 * The architecture already makes this true by construction: channel orders are
 * stored as `channel_order` rows and deliberately never converted into Medusa
 * orders, so they never reach the payout path at all (see the note on
 * `modules/channel-connector/models/channel-order.ts` — "forcing it through
 * FBM's checkout would invent a payment that never happened"). This module
 * turns that structural accident into a stated, tested rule, so a future
 * writer who *does* convert channel orders cannot quietly start billing them.
 *
 * Pure — no container, no I/O.
 */

import { FBM_CHANNEL } from "./channel-revenue"

/**
 * Where a sale originated, for commission purposes.
 *
 * Intentionally coarser than `OrderChannel` (online/pos/vending/pickup/
 * subscription). Every one of those is FBM checkout and every one of them is
 * commissionable, so distinguishing them here would invite a future exemption
 * that the rule above does not have.
 */
export type SaleOrigin =
  /** Went through FBM checkout, on any surface. Commissionable. */
  | { kind: "native"; channel?: string }
  /** Captured by an external marketplace and ingested. Not commissionable. */
  | { kind: "external_channel"; channel_id: string }

export class NonNativeCommissionError extends Error {
  constructor(channelId: string) {
    super(
      `refusing to apply FBM commission to a sale captured by "${channelId}": ` +
        "commission is for native sales. That marketplace already took its own " +
        "cut before the money reached the vendor, and FBM ran no checkout for it."
    )
    this.name = "NonNativeCommissionError"
  }
}

/** Does FBM's platform fee apply to this sale? */
export function isCommissionable(origin: SaleOrigin): boolean {
  return origin.kind === "native"
}

/**
 * Classify a revenue row by the channel label used across the revenue surfaces.
 *
 * `fbm` is the marketplace's own line; anything else is a connected external
 * channel. An empty or missing label is treated as native, matching
 * `rollUpChannelRevenue`, whose FBM line is the one built without a channel id.
 */
export function originForChannel(channel: string | null | undefined): SaleOrigin {
  const id = (channel ?? "").trim().toLowerCase()
  if (!id || id === FBM_CHANNEL) return { kind: "native", channel: FBM_CHANNEL }
  return { kind: "external_channel", channel_id: id }
}

/**
 * The commission on one native sale, in minor units.
 *
 * Throws rather than returning 0 for a non-native sale. A silent zero is
 * indistinguishable from "the rate happened to be 0%", and the difference
 * matters: one is policy, the other is a caller in the wrong place.
 *
 * Rounds half-up to the cent. At 3% the rounding is worth well under a cent
 * per order, but it has to be *a* rule rather than whatever the float did, so
 * that a breakdown's parts still sum to its total.
 */
export function commissionCentsForSale(args: {
  origin: SaleOrigin
  grossCents: number
  platformFeePercent: number
}): number {
  if (!isCommissionable(args.origin)) {
    throw new NonNativeCommissionError(
      args.origin.kind === "external_channel" ? args.origin.channel_id : "unknown"
    )
  }

  const gross = Math.max(0, Math.floor(args.grossCents))
  const percent = Number(args.platformFeePercent)

  if (!Number.isFinite(percent) || percent <= 0) return 0

  return Math.round((gross * percent) / 100)
}

/**
 * The fee to report for a revenue line, or `null` when it is genuinely unknown.
 *
 * `null` and `0` are different claims and the revenue surface treats them that
 * way: `null` increments `unreported_fee_orders` and qualifies the total, `0`
 * asserts that nothing was taken. An external channel that reported no fee is
 * unknown; a native sale's fee is never unknown, because FBM sets it.
 */
export function reportableFeeCents(args: {
  origin: SaleOrigin
  grossCents: number
  platformFeePercent: number
  /** What the external channel itself reported, when it reported anything. */
  channelReportedFeeCents?: number | null
}): number | null {
  if (args.origin.kind === "native") {
    return commissionCentsForSale({
      origin: args.origin,
      grossCents: args.grossCents,
      platformFeePercent: args.platformFeePercent,
    })
  }

  const reported = args.channelReportedFeeCents
  if (reported === null || reported === undefined) return null
  const value = Number(reported)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.floor(value)
}
