/**
 * Refrain (creator-bounty) module — invariants.
 *
 * Refrain is the connection-and-payment layer between any patron (a
 * vendor, or a non-vendor patron under explicit policy gates) and any
 * creator with a Refrain profile. A bounty is posted, a creator
 * claims it, escrow holds the amount until the deliverable is
 * accepted, then the EscrowAgreement releases.
 *
 * This module is framework-free. It defines the type unions and the
 * pure invariants that the service layer and tests assert against. The
 * router shape and the EscrowAgreement integration come in the service
 * (`service.ts`) and the workflow hooks; the rules below apply
 * regardless of where they're called from.
 *
 * Design intent (see `docs/COMPOSITION_LAYER.md` § "Not a Cameo /
 * Fiverr"):
 *
 *   - Rights default to creator-retains-ownership. The poster can opt
 *     to acquire a license at higher price tiers, but cannot
 *     unilaterally claim ownership.
 *   - Competitive mode pays a proposal honorarium so speculative work
 *     is not unpaid.
 *   - Time-locked auto-release protects creators from patron
 *     ghosting; the maximum review window is 14 days.
 */

export type BountyStatus =
  | "draft"        // poster is still editing; not visible to creators
  | "posted"       // visible; awaiting claims
  | "claimed"      // a creator has accepted; work in progress
  | "submitted"    // creator submitted deliverable; awaiting poster review
  | "accepted"     // poster accepted; escrow released
  | "rejected"     // poster rejected; dispute path
  | "expired"      // no submission within agreed window; escrow returned
  | "cancelled"    // poster cancelled pre-claim; escrow returned

export const BOUNTY_STATUSES: readonly BountyStatus[] = [
  "draft",
  "posted",
  "claimed",
  "submitted",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
] as const

/**
 * Allowed status transitions. Anything not in this map is a hard
 * rejection. The service layer asserts against this; the unit test
 * pins every transition explicitly.
 */
export const BOUNTY_TRANSITIONS: Record<BountyStatus, readonly BountyStatus[]> = {
  draft: ["posted", "cancelled"],
  posted: ["claimed", "cancelled", "expired"],
  claimed: ["submitted", "expired", "cancelled"],
  submitted: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
  expired: [],
  cancelled: [],
}

export type BountyRightsMode =
  | "creator_retains"      // default
  | "shared_attribution"   // creator + poster co-credit
  | "license_to_poster"    // poster licenses; creator retains ownership

export const BOUNTY_RIGHTS_MODES: readonly BountyRightsMode[] = [
  "creator_retains",
  "shared_attribution",
  "license_to_poster",
] as const

/** Pricing mode of the bounty. */
export type BountyPricingMode =
  | "fixed"          // a single fixed amount escrowed up front
  | "competitive"    // multiple proposals; honorarium paid to all

export const BOUNTY_PRICING_MODES: readonly BountyPricingMode[] = [
  "fixed",
  "competitive",
] as const

/**
 * The maximum review window between submission and auto-release.
 * Time-locked auto-release prevents patron ghosting; this is the
 * upper bound on how long a creator can be left waiting after
 * delivery. 14 days mirrors the EscrowAgreement default.
 */
export const MAX_REVIEW_WINDOW_DAYS = 14

/**
 * The honorarium percentage paid to losing proposals in competitive
 * mode. 10 % is small but non-zero — the principle is that
 * speculative work has compensation, not that honoraria pay rent.
 */
export const COMPETITIVE_HONORARIUM_PERCENT = 10

export function isBountyStatus(value: unknown): value is BountyStatus {
  return typeof value === "string" && (BOUNTY_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: BountyStatus, to: BountyStatus): boolean {
  return BOUNTY_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Validate the inputs to a bounty creation. Throws a descriptive
 * Error on the first violation. Returns the validated, normalised
 * shape on success.
 *
 * Hard invariants:
 *   - amount_minor must be a positive integer (cents/minor units).
 *   - currency_code must be a non-empty string.
 *   - review_window_days must be 1..MAX_REVIEW_WINDOW_DAYS.
 *   - title must be non-empty.
 */
export type BountyCreateInput = {
  title: string
  description?: string | null
  amount_minor: number
  currency_code: string
  pricing_mode: BountyPricingMode
  rights_mode: BountyRightsMode
  review_window_days: number
}

export function validateBountyCreate(input: unknown): BountyCreateInput {
  if (!input || typeof input !== "object") {
    throw new Error("bounty input must be an object")
  }
  const i = input as Record<string, unknown>

  if (typeof i.title !== "string" || i.title.trim().length === 0) {
    throw new Error("bounty.title is required")
  }
  if (
    typeof i.amount_minor !== "number" ||
    !Number.isInteger(i.amount_minor) ||
    i.amount_minor <= 0
  ) {
    throw new Error("bounty.amount_minor must be a positive integer")
  }
  if (typeof i.currency_code !== "string" || i.currency_code.trim().length === 0) {
    throw new Error("bounty.currency_code is required")
  }
  if (
    !BOUNTY_PRICING_MODES.includes(i.pricing_mode as BountyPricingMode)
  ) {
    throw new Error(
      `bounty.pricing_mode must be one of: ${BOUNTY_PRICING_MODES.join(", ")}`
    )
  }
  if (!BOUNTY_RIGHTS_MODES.includes(i.rights_mode as BountyRightsMode)) {
    throw new Error(
      `bounty.rights_mode must be one of: ${BOUNTY_RIGHTS_MODES.join(", ")}`
    )
  }
  if (
    typeof i.review_window_days !== "number" ||
    !Number.isInteger(i.review_window_days) ||
    i.review_window_days < 1 ||
    i.review_window_days > MAX_REVIEW_WINDOW_DAYS
  ) {
    throw new Error(
      `bounty.review_window_days must be an integer in [1, ${MAX_REVIEW_WINDOW_DAYS}]`
    )
  }

  return {
    title: i.title.trim(),
    description:
      typeof i.description === "string" ? i.description.trim() : null,
    amount_minor: i.amount_minor,
    currency_code: i.currency_code.trim().toUpperCase(),
    pricing_mode: i.pricing_mode as BountyPricingMode,
    rights_mode: i.rights_mode as BountyRightsMode,
    review_window_days: i.review_window_days,
  }
}

/**
 * Honorarium for losing proposals in competitive mode. Pure; the
 * service layer calls this when finalising a competitive bounty.
 */
export function computeHonorariumMinor(
  bountyAmountMinor: number,
  losingProposalsCount: number
): number {
  if (
    !Number.isFinite(bountyAmountMinor) ||
    bountyAmountMinor <= 0 ||
    !Number.isFinite(losingProposalsCount) ||
    losingProposalsCount <= 0
  ) {
    return 0
  }
  const totalPool = Math.floor(
    (bountyAmountMinor * COMPETITIVE_HONORARIUM_PERCENT) / 100
  )
  return Math.floor(totalPool / losingProposalsCount)
}
