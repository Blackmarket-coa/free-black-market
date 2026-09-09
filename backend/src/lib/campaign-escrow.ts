/**
 * Collective-campaign escrow helpers.
 *
 * All-or-nothing crowdfunding settlement is dark by default: the routes only
 * touch the hawala ledger when FBM_CAMPAIGN_ESCROW_LIVE=1, so the pre-flag
 * status-only behavior is byte-identical when the flag is unset.
 *
 * UNITS: Backing.amount (and every collective_campaign money column) is stored
 * in MAJOR units (NUMERIC dollars), matching hawala ledger balances — the
 * module has no `_cents` columns (contrast order-subcontract's `total_cents`).
 * The hawala campaign-escrow wrappers take integer cents at the boundary, so
 * routes convert with `campaignAmountToCents` (major -> minor via round).
 */

export const CAMPAIGN_ESCROW_FLAG = "FBM_CAMPAIGN_ESCROW_LIVE"

export function isCampaignEscrowLive(): boolean {
  return process.env[CAMPAIGN_ESCROW_FLAG] === "1"
}

/**
 * Securities gate for micro-investor backings.
 *
 * `docs/REPO_CONSOLIDATION_REVIEW.md` §8 gates coalition investing and
 * revenue-share on the Reg CF / CSA-style claim analysis, in words chosen to
 * forbid exactly the shape this module had: "These are hard release gates, not
 * configuration toggles." `FBM_CAMPAIGN_ESCROW_LIVE` is a configuration
 * toggle, and nothing in the escrow path distinguished a `MICRO_INVESTOR`
 * backing (a capped revenue-share claim) from a `PRE_ORDER` one (a forward
 * purchase of goods). Flipping one env var therefore shipped a cash-in path
 * for a revenue-share instrument.
 *
 * The two flags are deliberately different kinds of statement.
 * `FBM_CAMPAIGN_ESCROW_LIVE` describes a mechanism, so setting it reads like
 * enabling a feature. `FBM_SECURITIES_GATE_CLEARED` describes the world, so
 * setting it reads like a claim somebody has to be willing to make.
 *
 * A `PRE_ORDER` backing is unaffected: buying a unit of a production run is
 * the goods-or-services purchase Posture A's payment-facilitator frame rests
 * on. A micro-investment is not a purchase of anything, which is a second
 * reason — separate from the securities question — that it should not move
 * money before the gate is answered.
 *
 * See docs/TRANSMUTATION_STRATEGY.md §3.2 and §7.1.
 */
export const SECURITIES_GATE_FLAG = "FBM_SECURITIES_GATE_CLEARED"

export function isSecuritiesGateCleared(): boolean {
  return process.env[SECURITIES_GATE_FLAG] === "1"
}

export class SecuritiesGateError extends Error {
  constructor(mode: string) {
    super(
      `Backing mode ${mode} is gated: revenue-share cash-in requires the ` +
        `securities gate in docs/REPO_CONSOLIDATION_REVIEW.md §8 to be ` +
        `answered. Set ${SECURITIES_GATE_FLAG}=1 only once that work is ` +
        `complete. See docs/TRANSMUTATION_STRATEGY.md §7.1.`
    )
    this.name = "SecuritiesGateError"
  }
}

/**
 * Throws when a backing mode carries a securities claim and the gate above is
 * not cleared. Call before any ledger movement, not after.
 */
export function assertBackingModeReleasable(mode: string): void {
  if (mode !== "MICRO_INVESTOR") {
    return
  }
  if (isSecuritiesGateCleared()) {
    return
  }
  throw new SecuritiesGateError(mode)
}

/** Convert a major-unit (dollar) campaign amount to integer cents. */
export function campaignAmountToCents(amount: number): number {
  return Math.round(amount * 100)
}

// Backing.metadata keys linking a backing to its ledger entries. The backing
// model has no ledger columns, so the escrow linkage lives in metadata.
export const BACKING_ESCROW_ENTRY_KEY = "escrow_ledger_entry_id"
export const BACKING_ESCROW_CENTS_KEY = "escrow_amount_cents"
export const BACKING_REFUND_ENTRY_KEY = "refund_ledger_entry_id"

/**
 * Integer cents escrowed for a backing, or null when the backing was created
 * while escrow was dark (no ledger entry recorded — nothing to move).
 */
export function escrowedCentsForBacking(backing: {
  amount: unknown
  metadata?: Record<string, unknown> | null
}): number | null {
  const meta = backing.metadata ?? {}
  if (!meta[BACKING_ESCROW_ENTRY_KEY]) {
    return null
  }
  const stored = Number(meta[BACKING_ESCROW_CENTS_KEY])
  if (Number.isInteger(stored) && stored > 0) {
    return stored
  }
  return campaignAmountToCents(Number(backing.amount))
}
