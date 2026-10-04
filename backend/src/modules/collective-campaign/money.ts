import { campaignAmountToCents } from "../../lib/campaign-escrow"

/**
 * The one place the two unit systems in this module meet.
 *
 * Every pre-existing `collective_campaign` money column (`campaign_goal`,
 * `total_backed_amount`, `funding_goal_override`, ...) and `Backing.amount` is
 * MAJOR units (NUMERIC dollars) — `lib/campaign-escrow.ts` records why. The
 * shared-goal tables added for Phase 1 (`collective_campaign_participant`,
 * `collective_campaign_milestone`) and every shared-goal API field are INTEGER
 * CENTS, like `donation_split_record.gross_cents` they are reconciled against.
 *
 * Convert here, at the boundary, and nowhere else. Nothing in the module adds
 * a cents figure to a major-units figure.
 */
export { campaignAmountToCents }

/** Integer cents -> major-unit campaign amount (the campaign columns' unit). */
export function centsToCampaignAmount(cents: number): number {
  return cents / 100
}

/** True for a non-negative integer number of cents. */
export function isNonNegativeIntegerCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

/** True for a positive integer number of cents. */
export function isPositiveIntegerCents(value: unknown): value is number {
  return isNonNegativeIntegerCents(value) && value > 0
}
