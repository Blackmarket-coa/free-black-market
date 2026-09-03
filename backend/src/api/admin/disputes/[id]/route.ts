import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { ORDER_DISPUTE_MODULE } from "../../../../modules/order-dispute"
import type OrderDisputeService from "../../../../modules/order-dispute/service"
import { DisputeStateError } from "../../../../modules/order-dispute/service"
import {
  DisputeStatus,
  escrowTransitionFor,
} from "../../../../modules/order-dispute/resolution"

const log = createLogger("api/admin/disputes/[id]")

const getAdminId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id ?? "admin"

/** GET /admin/disputes/:id — the case file, including its full event log. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const [dispute] = (await service.listOrderDisputes({ id })) as unknown[]
  if (!dispute) return res.status(404).json({ message: "Dispute not found" })

  const events = await service.listOrderDisputeEvents(
    { dispute_id: id },
    { order: { created_at: "ASC" } }
  )

  return res.json({ dispute, events })
}

/**
 * PATCH /admin/disputes/:id — take it up, or decide it.
 *
 * Deciding records the outcome and the award. It does NOT move money: this
 * module owns the argument, not the ledger. The response names the escrow
 * transition the decision implies (`escrow_transition`), which is null for the
 * ordinary case where the order was never escrowed — most orders settle
 * through Stripe, and the refund follows through the payment provider.
 *
 * Saying that plainly is the point. Returning a fabricated "funds released"
 * for an order that holds none would be worse than useless to whoever has to
 * actually pay the buyer back.
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const body = (req.body ?? {}) as Record<string, unknown>
  const status =
    typeof body.status === "string" ? body.status.trim().toLowerCase() : ""

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const adminId = getAdminId(req)

  try {
    if (status === DisputeStatus.UNDER_REVIEW) {
      const dispute = await service.takeUnderReview({
        disputeId: id,
        adminId,
      })
      return res.json({ dispute, escrow_transition: null })
    }

    if (
      status === DisputeStatus.RESOLVED_REFUND ||
      status === DisputeStatus.RESOLVED_RELEASE
    ) {
      const dispute = await service.resolve({
        disputeId: id,
        adminId,
        status,
        awardCents:
          typeof body.award_amount === "number" ? body.award_amount : null,
        note: typeof body.note === "string" ? body.note : undefined,
      })

      return res.json({
        dispute,
        // What the escrow machine would be told, when there is an escrow.
        escrow_transition: dispute.escrow_agreement_id
          ? escrowTransitionFor(status)
          : null,
        escrow_agreement_id: dispute.escrow_agreement_id,
      })
    }

    if (status === DisputeStatus.WITHDRAWN) {
      const dispute = await service.withdraw({
        disputeId: id,
        actor: "admin",
        actorId: adminId,
        note: typeof body.note === "string" ? body.note : undefined,
      })
      return res.json({ dispute, escrow_transition: null })
    }

    return res.status(400).json({
      message:
        "status must be under_review, resolved_refund, resolved_release, or withdrawn",
    })
  } catch (err) {
    if (err instanceof DisputeStateError) {
      return res.status(409).json({ message: err.message })
    }
    log.error("[PATCH /admin/disputes/:id] failed", err)
    return res.status(500).json({ message: "Failed to update dispute" })
  }
}
