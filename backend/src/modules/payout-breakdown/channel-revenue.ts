/**
 * True net revenue across every channel a vendor sells through.
 *
 * Phase 11. The problem it solves is stated plainly in the roadmap: Etsy,
 * Amazon and Faire all take their cut *before* money reaches the vendor, so a
 * vendor reading gross figures from three places has no way to know what they
 * actually earned. Worse, the three numbers are not comparable — an FBM sale's
 * headline price is pre-platform-fee, a channel sale's is pre-channel-fee, and
 * adding them produces a total that is wrong in a direction that flatters us.
 *
 * Pure — no container, no I/O — so the arithmetic asserts directly. The reading
 * spans two modules and lives in `shared/cross-channel-revenue.ts`.
 */

/** Where a sale happened. `fbm` is the marketplace's own storefront. */
export const FBM_CHANNEL = "fbm" as const

export type ChannelRevenueInput = {
  /** Channel id, or `fbm`. */
  channel: string
  /** Minor units, gross — what the buyer paid. */
  gross_amount: number
  /**
   * Minor units taken before the vendor is paid: the channel's commission, or
   * FBM's own platform fee. `null` means the channel did not report one, which
   * is NOT the same as zero — see `unreported_fee_orders`.
   */
  fee_amount: number | null
  currency_code: string
}

export type ChannelRevenueLine = {
  channel: string
  orders: number
  gross_amount: number
  /** Fees we actually know about. */
  fee_amount: number
  /** Gross minus known fees. */
  net_amount: number
  /**
   * Orders whose fee the channel never reported.
   *
   * Surfaced rather than folded into the total because it is the one number
   * that tells a vendor how much to trust the rest: a net figure computed over
   * orders with unknown fees is an over-estimate, and quietly presenting it as
   * fact is how a vendor plans against money they will not receive.
   */
  unreported_fee_orders: number
  /** Share of gross taken as fees, rounded. `null` when gross is zero. */
  take_rate_percent: number | null
}

export type CrossChannelRevenue = {
  currency_code: string
  lines: ChannelRevenueLine[]
  totals: {
    orders: number
    gross_amount: number
    fee_amount: number
    net_amount: number
    unreported_fee_orders: number
    take_rate_percent: number | null
  }
  /**
   * True when any line has orders with unreported fees, so the caller can
   * qualify the total in one check rather than inspecting every line.
   */
  has_unreported_fees: boolean
}

/**
 * Roll sales up per channel, and compute what the vendor actually kept.
 *
 * Deliberate choices:
 *
 * - **Mixed currencies are not summed.** Adding 100 USD to 100 EUR produces a
 *   number that is wrong in every currency. Rows not matching the requested
 *   currency are dropped and the caller reports on one currency at a time;
 *   pretending otherwise would be the single easiest way for this to lie.
 * - **A `null` fee counts the order but not a fee**, and increments
 *   `unreported_fee_orders`. Treating unknown as zero would silently claim the
 *   channel took nothing.
 * - **Negative amounts are clamped, not propagated.** A refund is its own
 *   record; a negative here is a mapping bug, and letting it through would
 *   quietly inflate net revenue.
 * - **Lines are sorted by gross, descending** — the channel that matters most
 *   is the one a vendor should read first.
 */
export function rollUpChannelRevenue(
  rows: readonly ChannelRevenueInput[],
  currencyCode: string
): CrossChannelRevenue {
  const currency = (currencyCode || "usd").toUpperCase()

  const byChannel = new Map<string, ChannelRevenueLine>()

  for (const row of rows) {
    if ((row.currency_code || "").toUpperCase() !== currency) continue

    const channel = (row.channel || "").trim() || "unknown"
    const gross = Math.max(0, Math.round(row.gross_amount || 0))
    const feeKnown = row.fee_amount !== null && row.fee_amount !== undefined
    const fee = feeKnown ? Math.max(0, Math.round(row.fee_amount as number)) : 0

    const line =
      byChannel.get(channel) ??
      {
        channel,
        orders: 0,
        gross_amount: 0,
        fee_amount: 0,
        net_amount: 0,
        unreported_fee_orders: 0,
        take_rate_percent: null,
      }

    line.orders += 1
    line.gross_amount += gross
    line.fee_amount += fee
    if (!feeKnown) line.unreported_fee_orders += 1

    byChannel.set(channel, line)
  }

  const lines = [...byChannel.values()]
    .map((l) => ({
      ...l,
      // Never negative: a fee larger than gross is a data problem, and showing
      // negative earnings would send a vendor looking for money they lost
      // rather than for the bad row.
      net_amount: Math.max(0, l.gross_amount - l.fee_amount),
      take_rate_percent:
        l.gross_amount > 0
          ? Math.round((l.fee_amount / l.gross_amount) * 100)
          : null,
    }))
    .sort((a, b) => b.gross_amount - a.gross_amount)

  const totals = lines.reduce(
    (acc, l) => ({
      orders: acc.orders + l.orders,
      gross_amount: acc.gross_amount + l.gross_amount,
      fee_amount: acc.fee_amount + l.fee_amount,
      net_amount: acc.net_amount + l.net_amount,
      unreported_fee_orders: acc.unreported_fee_orders + l.unreported_fee_orders,
      take_rate_percent: null as number | null,
    }),
    {
      orders: 0,
      gross_amount: 0,
      fee_amount: 0,
      net_amount: 0,
      unreported_fee_orders: 0,
      take_rate_percent: null as number | null,
    }
  )

  totals.take_rate_percent =
    totals.gross_amount > 0
      ? Math.round((totals.fee_amount / totals.gross_amount) * 100)
      : null

  return {
    currency_code: currency,
    lines,
    totals,
    has_unreported_fees: totals.unreported_fee_orders > 0,
  }
}

/**
 * Which channel earned the vendor the most, after fees.
 *
 * Ranked on **net**, not gross, because that is the entire point: a channel
 * with higher sales and a 25% cut can be worth less than a quieter one taking
 * 3%, and ranking on gross would recommend the wrong place to put effort.
 *
 * Returns `null` when a comparison would be meaningless — nothing sold, or
 * only one channel, where "best" is not a finding.
 */
export function bestNetChannel(
  revenue: CrossChannelRevenue
): { channel: string; net_amount: number } | null {
  const earning = revenue.lines.filter((l) => l.net_amount > 0)
  if (earning.length < 2) return null

  const best = earning.reduce((a, b) => (b.net_amount > a.net_amount ? b : a))
  return { channel: best.channel, net_amount: best.net_amount }
}
