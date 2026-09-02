import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { ORDER_DISPUTE_MODULE } from "../../../../modules/order-dispute"
import type OrderDisputeService from "../../../../modules/order-dispute/service"
import { DisputeStateError } from "../../../../modules/order-dispute/service"

const log = createLogger("api/vendor/disputes/[id]")

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const [row] = (await service.listOrderDisputes({ id })) as unknown[]
  const dispute = row as { seller_id: string } | undefined

  if (!dispute || dispute.seller_id !== sellerId) {
    return res.status(404).json({ message: "Dispute not found" })
  }

  const events = await service.listOrderDisputeEvents(
    { dispute_id: id },
    { order: { created_at: "ASC" } }
  )

  return res.json({ dispute, events })
}

/**
 * POST /vendor/disputes/:id — the vendor's answer.
 *
 * Recorded as evidence; it does not move the case. Letting a response advance
 * the status would let the party being complained about drive the process
 * they are the subject of. Only an admin resolves.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const body = (req.body ?? {}) as { response?: string }
  const response = typeof body.response === "string" ? body.response.trim() : ""
  if (!response) {
    return res.status(400).json({ message: "a response is required" })
  }

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)

  try {
    const dispute = await service.respond({
      disputeId: id,
      sellerId,
      response,
    })
    return res.json({ dispute })
  } catch (err) {
    if (err instanceof DisputeStateError) {
      // "not the vendor on this dispute" must not confirm the id exists.
      if (/not the vendor/.test(err.message)) {
        return res.status(404).json({ message: "Dispute not found" })
      }
      return res.status(409).json({ message: err.message })
    }
    log.error("[POST /vendor/disputes/:id] failed", err)
    return res.status(500).json({ message: "Failed to record response" })
  }
}
