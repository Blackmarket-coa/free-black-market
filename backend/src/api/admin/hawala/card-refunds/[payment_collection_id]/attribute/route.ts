import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { attributeCollectionRefund } from "../../../../../../lib/card-refund-attribution"
import { adminActorId } from "../../../advances/orgs/org-advance-shared"
import { AttributeRefundBody, cardLedgerDisabled, sendRefundAttributionError } from "../../card-refund-shared"

/**
 * POST /admin/hawala/card-refunds/:payment_collection_id/attribute (SD-40)
 *
 * Assign a refund on a shared Mercur cart to the sellers' orders:
 * `{ allocations: [{ order_id, amount }] }`, major units, adding up exactly
 * to the collection's unassigned refund (`GET` on the collection shows it).
 * Records it on each order's split row as Mercur's own split refund would,
 * releases the collection's payout holds, and posts each order's refund to
 * its seller (`lib/card-refund-attribution.ts`). Never calls Stripe: the
 * customer has already been refunded.
 *
 * 401 without an admin actor (the record names who assigned it); 400 when
 * the amounts do not add up or an order cannot take its share; 409 when
 * there is nothing left to assign (a retry, or another admin got there
 * first).
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (cardLedgerDisabled(res)) return
  const parsed = AttributeRefundBody.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      type: "invalid_request",
      message: "Invalid refund assignment",
      errors: z.flattenError(parsed.error),
    })
  }
  const actorId = adminActorId(req)
  if (!actorId) {
    return res.status(401).json({ type: "unauthorized", message: "An assignment must name who made it." })
  }
  try {
    const result = await attributeCollectionRefund(req.scope, {
      payment_collection_id: req.params.payment_collection_id,
      allocations: parsed.data.allocations,
      actor_id: actorId,
    })
    return res.status(200).json(result)
  } catch (error) {
    return sendRefundAttributionError(res, error)
  }
}
