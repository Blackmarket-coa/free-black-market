/**
 * What each party is shown of a dispute: an explicit list of fields, never
 * the raw row.
 *
 * Pure, container-free. The row carries things only the operators should
 * see: `resolved_by` (the deciding admin's internal user id),
 * `escrow_agreement_id`, and a free `metadata` column holding the intake's
 * bookkeeping (`amount_unit`, `intake_source`, `legacy_request_id`) and the
 * corrective script's `amount_units_corrected` record. The event log adds
 * each actor's internal id. `GET /store/orders/:id/dispute` returned all of
 * that to the buyer; the vendor read returned it too, though no vendor could
 * reach it until it resolved the seller properly (see
 * `api/vendor/disputes`). A field reaches a party only by being named here.
 */

const BUYER_DISPUTE_FIELDS = [
  "id",
  "order_id",
  "seller_id",
  "status",
  "reason",
  "description",
  "currency_code",
  "claim_amount",
  "award_amount",
  "resolution_note",
  "resolved_at",
  "created_at",
  "updated_at",
] as const

/**
 * The respondent's view: the buyer's account and the claim, their own reply,
 * and the decision with its note. Not the buyer's customer id, the deciding
 * admin, the escrow id or the metadata.
 */
const VENDOR_DISPUTE_FIELDS = [
  "id",
  "order_id",
  "status",
  "reason",
  "description",
  "currency_code",
  "claim_amount",
  "award_amount",
  "seller_response",
  "seller_responded_at",
  "resolution_note",
  "resolved_at",
  "created_at",
  "updated_at",
] as const

/** An event as the vendor reads it: what happened and by which party, not by whom. */
const VENDOR_EVENT_FIELDS = [
  "id",
  "kind",
  "actor_type",
  "from_status",
  "to_status",
  "message",
  "created_at",
] as const

type Pick<F extends readonly string[]> = { [K in F[number]]?: unknown }

function pick<F extends readonly string[]>(row: unknown, fields: F): Pick<F> {
  const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in source) out[field] = source[field]
  }
  return out as Pick<F>
}

export type BuyerDisputeView = Pick<typeof BUYER_DISPUTE_FIELDS>
export type VendorDisputeView = Pick<typeof VENDOR_DISPUTE_FIELDS>
export type VendorDisputeEventView = Pick<typeof VENDOR_EVENT_FIELDS>

export const toBuyerDisputeView = (row: unknown): BuyerDisputeView => pick(row, BUYER_DISPUTE_FIELDS)
export const toVendorDisputeView = (row: unknown): VendorDisputeView => pick(row, VENDOR_DISPUTE_FIELDS)
export const toVendorDisputeEventView = (event: unknown): VendorDisputeEventView =>
  pick(event, VENDOR_EVENT_FIELDS)
