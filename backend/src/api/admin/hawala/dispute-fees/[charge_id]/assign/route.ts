import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { assignDisputeFee } from "../../../../../../lib/card-dispute-fee-assignment"
import { adminActorId } from "../../../advances/orgs/org-advance-shared"
import { cardLedgerDisabled } from "../../../card-refunds/card-refund-shared"
import { AssignDisputeFeeBody, sendDisputeFeeError } from "../../dispute-fee-shared"

/**
 * POST /admin/hawala/dispute-fees/:charge_id/assign (SD-44 (a))
 *
 * `{ allocations: [{ order_id, amount }], bmc_absorbs? }`, major units,
 * adding up exactly to the charge's unassigned fee. Each order's share is
 * owed by its seller from then on (recovered from their next sales, forgiven
 * after 180 days); `bmc_absorbs` is left with BMC. The charge is the admin's
 * from the first assignment: the automatic rule never posts on it again.
 * Never calls Stripe.
 *
 * 401 without an admin actor (the record names who assigned it); 400 when
 * the amounts do not add up, an order is not on the cart or has not settled;
 * 409 when the fee is assigned automatically or nothing is left (a retry, or
 * another admin got there first); 404 when no fee is recorded on the charge.
 */
export async function POST(req: MedusaRequest<unknown>, res: MedusaResponse) {
  if (cardLedgerDisabled(res)) return
  const parsed = AssignDisputeFeeBody.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      type: "invalid_request",
      message: "Invalid dispute-fee assignment",
      errors: z.flattenError(parsed.error),
    })
  }
  const actorId = adminActorId(req)
  if (!actorId) {
    return res.status(401).json({ type: "unauthorized", message: "An assignment must name who made it." })
  }
  try {
    const result = await assignDisputeFee(req.scope, {
      stripe_charge_id: req.params.charge_id,
      allocations: parsed.data.allocations,
      ...(parsed.data.bmc_absorbs !== undefined ? { bmc_absorbs: parsed.data.bmc_absorbs } : {}),
      actor_id: actorId,
    })
    return res.status(200).json(result)
  } catch (error) {
    return sendDisputeFeeError(res, error)
  }
}
