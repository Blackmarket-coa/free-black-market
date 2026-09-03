import { DisputeReason, DisputeStatus } from "./resolution"

/**
 * Compatibility between the retired `order_claim` request type and
 * `order_dispute`.
 *
 * Pure, container-free. FBM shipped two buyer-facing complaint systems within
 * a week of each other: `POST /store/order-claims` (built on the generic
 * `request` model, with a storefront section and a public `/buyer-protection`
 * page) and `modules/order-dispute` (per-vendor scoping, claim and award
 * amounts, a vendor right of reply, an append-only event log). The operator
 * chose order-dispute as the single engine on 2026-09-03.
 *
 * This file is what lets the storefront keep the surface buyers already have.
 * The claims route stays at the same path with the same request and response
 * shapes; underneath, it files an `order_dispute`. Everything that translates
 * between the two vocabularies lives here so it is written once and tested
 * once.
 */

/** The reasons the storefront's claim form offers. Kept verbatim. */
export type ClaimReason =
  | "not_received"
  | "not_as_described"
  | "damaged"
  | "missing_items"

export const CLAIM_REASONS: readonly ClaimReason[] = [
  "not_received",
  "not_as_described",
  "damaged",
  "missing_items",
]

/**
 * The status vocabulary the storefront's `OrderClaim` type expects — the
 * generic `request` lifecycle it was originally built on.
 */
export type ClaimStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "completed"
  | "cancelled"

export function isClaimReason(value: unknown): value is ClaimReason {
  return typeof value === "string" && (CLAIM_REASONS as string[]).includes(value)
}

/**
 * Claim reason → dispute reason. Three map by name; `missing_items` is what
 * the dispute vocabulary calls `incomplete`.
 */
export function claimReasonToDisputeReason(reason: ClaimReason): DisputeReason {
  switch (reason) {
    case "not_received":
      return DisputeReason.NOT_RECEIVED
    case "not_as_described":
      return DisputeReason.NOT_AS_DESCRIBED
    case "damaged":
      return DisputeReason.DAMAGED
    case "missing_items":
      return DisputeReason.INCOMPLETE
  }
}

/**
 * Dispute reason → claim reason, for presenting a dispute back through the
 * claims surface. Reasons the claim form never offered (`billing`, `other`)
 * fall back to `not_as_described`, which is the closest thing the storefront
 * can render — but the original claim reason is stored on the dispute's
 * metadata at intake, and `toLegacyClaim` prefers that when present, so a
 * claim filed through the storefront always reads back exactly as filed.
 */
export function disputeReasonToClaimReason(reason: DisputeReason): ClaimReason {
  switch (reason) {
    case DisputeReason.NOT_RECEIVED:
      return "not_received"
    case DisputeReason.DAMAGED:
      return "damaged"
    case DisputeReason.INCOMPLETE:
      return "missing_items"
    case DisputeReason.NOT_AS_DESCRIBED:
    case DisputeReason.BILLING:
    case DisputeReason.OTHER:
    default:
      return "not_as_described"
  }
}

/**
 * Dispute status → the request-style status the storefront renders.
 *
 * `open` and `under_review` both present as `pending`: from the buyer's side
 * both mean "someone is looking at it", and the storefront never distinguished
 * them. A refund is the claim being `accepted`; a release is it being
 * `rejected`. `completed` is never produced — the request lifecycle had it as
 * a post-acceptance step that disputes fold into `resolved_refund`.
 */
export function disputeStatusToClaimStatus(status: DisputeStatus): ClaimStatus {
  switch (status) {
    case DisputeStatus.OPEN:
    case DisputeStatus.UNDER_REVIEW:
      return "pending"
    case DisputeStatus.RESOLVED_REFUND:
      return "accepted"
    case DisputeStatus.RESOLVED_RELEASE:
      return "rejected"
    case DisputeStatus.WITHDRAWN:
      return "cancelled"
  }
}

export type LegacyClaim = {
  id: string
  status: ClaimStatus
  reviewer_note: string | null
  created_at: string | Date
  data: {
    order_id: string
    reason: ClaimReason
    description: string
    evidence_urls?: string[]
    contacted_seller?: boolean
    /** New in the dispute-backed version; harmless to older readers. */
    seller_id?: string
    claim_amount?: number
    award_amount?: number
  }
}

type DisputeLike = {
  id: string
  order_id: string
  seller_id: string
  status: DisputeStatus
  reason: DisputeReason
  description: string
  claim_amount?: number | null
  award_amount?: number | null
  resolution_note?: string | null
  created_at?: string | Date | null
  metadata?: Record<string, unknown> | null
}

/** Metadata keys the claims intake writes so the round-trip is lossless. */
export const CLAIM_METADATA_KEYS = {
  reason: "claim_reason",
  evidenceUrls: "evidence_urls",
  contactedSeller: "contacted_seller",
  source: "intake_source",
} as const

/**
 * Present a dispute in the shape the storefront's `OrderClaim` type expects.
 *
 * Prefers the original claim reason from metadata over a lossy reverse-map,
 * so a claim reads back exactly as the buyer filed it.
 */
export function toLegacyClaim(dispute: DisputeLike): LegacyClaim {
  const md = dispute.metadata ?? {}
  const storedReason = md[CLAIM_METADATA_KEYS.reason]
  const reason = isClaimReason(storedReason)
    ? storedReason
    : disputeReasonToClaimReason(dispute.reason)

  const evidence = md[CLAIM_METADATA_KEYS.evidenceUrls]
  const contacted = md[CLAIM_METADATA_KEYS.contactedSeller]

  return {
    id: dispute.id,
    status: disputeStatusToClaimStatus(dispute.status),
    reviewer_note: dispute.resolution_note ?? null,
    created_at: dispute.created_at ?? new Date(0),
    data: {
      order_id: dispute.order_id,
      reason,
      description: dispute.description,
      ...(Array.isArray(evidence)
        ? { evidence_urls: evidence.filter((u): u is string => typeof u === "string") }
        : {}),
      ...(typeof contacted === "boolean" ? { contacted_seller: contacted } : {}),
      seller_id: dispute.seller_id,
      claim_amount: Math.floor(Number(dispute.claim_amount) || 0),
      award_amount: Math.floor(Number(dispute.award_amount) || 0),
    },
  }
}
