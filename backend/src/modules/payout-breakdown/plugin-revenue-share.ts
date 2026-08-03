/**
 * Plugin developer revenue share.
 *
 * `payout_config.plugin_developer_percent` and `FeeType.PLUGIN_DEVELOPER_FEE`
 * have existed in the model, the migrations and the enum since
 * `Migration20260506200AddPluginAndReferralSplits` but were read nowhere — no
 * code computed the fee, resolved a payee, or moved the money. This is that
 * computation. Pure, like `utils/dunning.ts` and `fee-resolution.ts`, so the
 * allocation can be asserted to the cent without a container.
 *
 * ## Two decisions the stored config did not settle
 *
 * **1. The share is carved OUT of the platform fee, not added on top.**
 *
 * The alternative — charging the seller an extra percentage because they
 * installed a plugin — makes adoption cost a vendor money, which is exactly
 * backwards: the vendor would uninstall, and the developer would earn nothing.
 * Carving it out means the platform shares revenue it was already taking, a
 * vendor's net is byte-for-byte unchanged whether they install plugins or not,
 * and the payout can never exceed what was actually collected. It also bounds
 * the failure mode: an over-large `plugin_developer_percent` caps at the
 * platform fee instead of driving platform revenue negative.
 *
 * **2. With several plugins installed the share is split evenly between them.**
 *
 * Nothing in the schema attributes an order to one plugin, and inventing an
 * attribution signal (last-installed? most-used?) would be a guess dressed up
 * as a rule. An even split is the one division that needs no such signal, and
 * it is explained to the vendor as "your plugin developers share X% of our
 * fee". First-party plugins (`author_seller_id === null`) have no external
 * payee, so their slice stays with the platform rather than being redistributed
 * — otherwise installing one first-party plugin would quietly raise every other
 * developer's cut.
 */

/** A plugin that could be paid for this order. */
export type PluginPayee = {
  slug: string
  /** Null for first-party plugins — no external developer to pay. */
  author_seller_id: string | null
}

export type PluginShareAllocation = {
  slug: string
  author_seller_id: string
  amount_cents: number
}

export type PluginRevenueShare = {
  /** Total moved to developers, in cents. Always ≤ `platformFeeCents`. */
  total_cents: number
  allocations: PluginShareAllocation[]
  /** What the platform keeps after the share. Never negative. */
  platform_retained_cents: number
}

const EMPTY: PluginRevenueShare = {
  total_cents: 0,
  allocations: [],
  platform_retained_cents: 0,
}

/**
 * Split a slice of the platform fee between the developers of the plugins a
 * seller has installed.
 *
 * `sellerId` is excluded from the payees: a vendor who wrote their own plugin
 * would otherwise be paid out of their own order, a round trip that nets to
 * zero but shows up in the ledger as real movement and inflates the developer's
 * earnings reporting.
 */
export function computePluginRevenueShare(input: {
  /** The platform fee already computed for this seller's slice, in cents. */
  platformFeeCents: number
  /** `payout_config.plugin_developer_percent`, as a percentage of seller gross. */
  pluginDeveloperPercent: number
  /** The seller's gross for this order, in cents. */
  sellerSubtotalCents: number
  /** Plugins the seller has installed. */
  plugins: PluginPayee[]
  /** The selling vendor, excluded from payees. */
  sellerId: string
}): PluginRevenueShare {
  const platformFee = Math.max(0, Math.floor(input.platformFeeCents || 0))

  if (
    !Number.isFinite(input.pluginDeveloperPercent) ||
    input.pluginDeveloperPercent <= 0 ||
    input.pluginDeveloperPercent > 100 ||
    platformFee <= 0
  ) {
    return { ...EMPTY, platform_retained_cents: platformFee }
  }

  const payees = input.plugins.filter(
    (p) => p.author_seller_id && p.author_seller_id !== input.sellerId
  )
  if (payees.length === 0) {
    return { ...EMPTY, platform_retained_cents: platformFee }
  }

  const subtotal = Math.max(0, Math.floor(input.sellerSubtotalCents || 0))
  const desired = Math.round(subtotal * (input.pluginDeveloperPercent / 100))

  // The cap is the whole point of carving out rather than adding on: a
  // misconfigured percentage costs the platform its fee, never the seller their
  // payout.
  const pool = Math.min(desired, platformFee)
  if (pool <= 0) {
    return { ...EMPTY, platform_retained_cents: platformFee }
  }

  // Deterministic order so the same order always allocates the same remainder
  // cents — a replayed settlement must reproduce the ledger exactly.
  const ordered = [...payees].sort((a, b) => a.slug.localeCompare(b.slug))

  const base = Math.floor(pool / ordered.length)
  let remainder = pool - base * ordered.length

  const allocations: PluginShareAllocation[] = []
  for (const plugin of ordered) {
    // Distribute the leftover cents one at a time rather than rounding each
    // share, so the allocations always sum to exactly `pool`.
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    const amount = base + extra
    if (amount <= 0) continue
    allocations.push({
      slug: plugin.slug,
      author_seller_id: plugin.author_seller_id as string,
      amount_cents: amount,
    })
  }

  const total = allocations.reduce((sum, a) => sum + a.amount_cents, 0)

  return {
    total_cents: total,
    allocations,
    platform_retained_cents: platformFee - total,
  }
}
