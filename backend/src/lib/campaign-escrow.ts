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
