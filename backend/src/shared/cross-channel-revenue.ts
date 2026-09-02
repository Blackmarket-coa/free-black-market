import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { getSellerOrders } from "./seller-orders"
import { CHANNEL_CONNECTOR_MODULE } from "../modules/channel-connector/module-key"
import type ChannelConnectorService from "../modules/channel-connector/service"
import {
  FBM_CHANNEL,
  rollUpChannelRevenue,
  type ChannelRevenueInput,
  type CrossChannelRevenue,
} from "../modules/payout-breakdown/channel-revenue"
import { reportableFeeCents } from "../modules/payout-breakdown/commission-scope"
import { PAYOUT_BREAKDOWN_MODULE } from "../modules/payout-breakdown"
import type PayoutBreakdownService from "../modules/payout-breakdown/service"

/**
 * The commission rate to report on FBM's own line when the seller's effective
 * rate cannot be read. The platform default, and what `payout_config` ships
 * with — see `docs/ADDON_COMMITMENTS.md` §3 on why it does not creep upward.
 */
const DEFAULT_PLATFORM_FEE_PERCENT = 3

const log = createLogger("shared/cross-channel-revenue")

/**
 * `getSellerOrders` does not surface a per-order currency, and the store runs
 * one currency per region. Rather than invent a currency per order, FBM lines
 * are reported in this one and the roll-up's currency filter does the rest.
 */
const FBM_CURRENCY_FALLBACK = "usd"

/**
 * Gather a vendor's sales from every channel, including FBM itself.
 *
 * The composition point for Phase 11. `payout-breakdown` cannot reach
 * `channel-connector` and neither can reach Medusa's order graph, so the
 * joining happens here and the arithmetic stays pure next door.
 *
 * FBM's own sales are included deliberately. A "cross-channel" report that
 * omitted the marketplace's own storefront would answer the wrong question —
 * a vendor deciding where to put effort needs to compare Faire against FBM,
 * not against nothing.
 */

/**
 * FBM orders for this seller.
 *
 * Delegates to `getSellerOrders` rather than querying the order graph again.
 * That helper already resolves the seller→product link and, critically,
 * pre-filters each order's items to this seller's own products — on a
 * multi-vendor order, counting the whole order total would credit a vendor
 * with another vendor's sales. `seller_total_cents` is the figure that is
 * actually theirs.
 */
async function loadFbmSales(
  container: MedusaContainer,
  sellerId: string,
  since: Date,
  platformFeePercent: number
): Promise<ChannelRevenueInput[]> {
  try {
    const orders = await getSellerOrders(container, sellerId)

    return orders
      .filter((o) => new Date(o.created_at) >= since)
      .map((o) => {
        const gross = Math.round(o.seller_total_cents ?? 0)
        return {
          channel: FBM_CHANNEL,
          gross_amount: gross,
          /**
           * FBM's commission is computed here rather than left unknown.
           *
           * These are native sales — they went through FBM checkout — so the
           * fee is the seller's effective platform rate (3% by default) and
           * FBM is the one who knows it. Reporting `null` used to make every
           * FBM line count as an unreported fee, which meant the one take
           * rate a vendor could always have been told was the only one the
           * screen refused to state, and `has_unreported_fees` was true even
           * for a vendor who sells nowhere else.
           *
           * Externally captured sales keep reporting whatever the channel
           * itself reported, and `null` when it reported nothing — see
           * `reportableFeeCents`.
           */
          fee_amount: reportableFeeCents({
            origin: { kind: "native", channel: FBM_CHANNEL },
            grossCents: gross,
            platformFeePercent,
          }),
          currency_code: FBM_CURRENCY_FALLBACK,
        }
      })
  } catch (err) {
    // A failed FBM read yields no FBM line rather than an empty report: the
    // channel figures are still true on their own, and a partial answer beats
    // a 500 on a screen whose job is to show a vendor where they stand.
    log.warn(`[revenue] FBM order read failed for ${sellerId}`, err)
    return []
  }
}

/** Ingested channel orders, which already carry the channel's own cut. */
async function loadChannelSales(
  container: MedusaContainer,
  sellerId: string,
  since: Date
): Promise<ChannelRevenueInput[]> {
  try {
    const service = container.resolve<ChannelConnectorService>(
      CHANNEL_CONNECTOR_MODULE
    )
    const rows = (await service.listChannelOrderRecords({
      seller_id: sellerId,
      placed_at: { $gte: since },
    })) as unknown as {
      channel_id: string
      currency_code: string
      total_amount: number | string
      channel_fee_amount: number | string | null
    }[]

    return (rows ?? []).map((o) => ({
      channel: o.channel_id,
      gross_amount: Number(o.total_amount),
      // Captured at ingestion precisely so this does not have to be
      // reconstructed later — see the note on the channel_order model.
      fee_amount:
        o.channel_fee_amount === null || o.channel_fee_amount === undefined
          ? null
          : Number(o.channel_fee_amount),
      currency_code: o.currency_code,
    }))
  } catch (err) {
    log.warn(`[revenue] channel order read failed for ${sellerId}`, err)
    return []
  }
}

/**
 * What a vendor actually earned, per channel, over a window.
 *
 * Never throws — both reads degrade to "no rows from that source", so the
 * worst case is a thinner report rather than an error on a revenue screen.
 */
export async function collectCrossChannelRevenue(
  container: MedusaContainer,
  sellerId: string,
  options: { since: Date; currencyCode?: string }
): Promise<CrossChannelRevenue> {
  const platformFeePercent = await loadPlatformFeePercent(container, sellerId)

  const [fbm, channels] = await Promise.all([
    loadFbmSales(container, sellerId, options.since, platformFeePercent),
    loadChannelSales(container, sellerId, options.since),
  ])

  const rows = [...fbm, ...channels]

  // One currency at a time — see `rollUpChannelRevenue` on why mixing them
  // produces a number that is wrong in every currency. Defaults to whichever
  // currency the vendor sells most in rather than a hardcoded USD.
  const currency =
    options.currencyCode ?? dominantCurrency(rows) ?? "usd"

  return rollUpChannelRevenue(rows, currency)
}

/**
 * The seller's effective commission rate, for reporting FBM's own line.
 *
 * Degrades to the platform default rather than throwing, on the same reasoning
 * as the two order reads above: a revenue screen that 500s tells the vendor
 * less than one that reports the standard rate. A seller on a genuine
 * concession sees their real rate whenever the read succeeds.
 */
async function loadPlatformFeePercent(
  container: MedusaContainer,
  sellerId: string
): Promise<number> {
  try {
    const service = container.resolve<PayoutBreakdownService>(
      PAYOUT_BREAKDOWN_MODULE
    )
    const percent = await service.getEffectivePlatformFee(sellerId)
    return Number.isFinite(percent) && percent >= 0
      ? percent
      : DEFAULT_PLATFORM_FEE_PERCENT
  } catch (err) {
    log.warn(`[revenue] platform fee read failed for ${sellerId}`, err)
    return DEFAULT_PLATFORM_FEE_PERCENT
  }
}

/** The currency the most orders are denominated in. */
function dominantCurrency(rows: readonly ChannelRevenueInput[]): string | null {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const c = (r.currency_code || "").toUpperCase()
    if (!c) continue
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c
      bestN = n
    }
  }
  return best
}
