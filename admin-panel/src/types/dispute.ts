/**
 * Buyer disputes (order claims), as `GET /admin/disputes`,
 * `GET /admin/disputes/:id` and `PATCH /admin/disputes/:id` return them.
 *
 * The backend vocabulary is `backend/src/modules/order-dispute/resolution.ts`;
 * `routes/disputes/dispute-rules.spec.ts` fails if these drift from it.
 *
 * `claim_amount` and `award_amount` are integers in the currency's minor
 * unit, as the `order_dispute` model declares.
 */

export type DisputeStatus =
  | "open"
  | "under_review"
  | "resolved_refund"
  | "resolved_release"
  | "withdrawn"

export type DisputeReason =
  | "not_received"
  | "not_as_described"
  | "damaged"
  | "incomplete"
  | "billing"
  | "other"

export type DisputeActorType = "buyer" | "seller" | "admin" | "system"

/** A row of `order_dispute`. */
export type AdminDispute = {
  id: string
  order_id: string
  seller_id: string
  customer_id: string
  status: DisputeStatus
  reason: DisputeReason
  description: string
  currency_code: string
  claim_amount: number
  award_amount: number
  seller_response: string | null
  seller_responded_at: string | null
  resolution_note: string | null
  resolved_at: string | null
  resolved_by: string | null
  escrow_agreement_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/** A row of the append-only `order_dispute_event` log. */
export type AdminDisputeEvent = {
  id: string
  kind: string
  actor_type: DisputeActorType | string
  actor_id: string | null
  from_status: DisputeStatus | null
  to_status: DisputeStatus | null
  message: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type AdminDisputeListParams = { status?: DisputeStatus }
export type AdminDisputeListResponse = { disputes: AdminDispute[]; count: number }
export type AdminDisputeResponse = { dispute: AdminDispute; events: AdminDisputeEvent[] }

export type AdminDisputeUpdateBody = {
  status: DisputeStatus
  award_amount?: number
  note?: string
}

export type AdminDisputeUpdateResponse = {
  dispute: AdminDispute
  /** What a linked escrow would be told; null when the order holds no escrow. */
  escrow_transition: "resolve_dispute_release" | "recover" | null
  escrow_agreement_id?: string | null
}
