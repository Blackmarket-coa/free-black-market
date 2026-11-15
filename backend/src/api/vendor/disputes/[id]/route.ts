import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../../shared/logger"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { ORDER_DISPUTE_MODULE } from "../../../../modules/order-dispute"
import type OrderDisputeService from "../../../../modules/order-dispute/service"
import { DisputeStateError } from "../../../../modules/order-dispute/service"
import {
  toVendorDisputeEventView,
  toVendorDisputeView,
} from "../../../../modules/order-dispute/views"

const log = createLogger("api/vendor/disputes/[id]")

/**
 * GET /vendor/disputes/:id — one claim against this vendor: the buyer's
 * account, the vendor's own reply, the decision and its note, and the event
 * log, as `toVendorDisputeView` allows (no admin or customer ids, no
 * metadata).
 *
 * Both handlers resolve the seller with `requireSellerId` (member → seller).
 * They compared `auth_context.actor_id`, a vendor login's member id, with
 * the dispute's seller id, so every read and every reply answered 404.
 * Another vendor's dispute is the same 404 as no dispute.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const id = (req.params as { id?: string })?.id
  if (!id) return res.status(400).json({ message: "Missing id" })

  const service = req.scope.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)
  const [row] = (await service.listOrderDisputes({ id })) as unknown[]
  const dispute = row as { seller_id: string } | undefined

  if (!dispute || dispute.seller_id !== sellerId) {
    return res.status(404).json({ message: "Dispute not found" })
  }

  const events = (await service.listOrderDisputeEvents(
    { dispute_id: id },
    { order: { created_at: "ASC" } }
  )) as unknown[]

  return res.json({
    dispute: toVendorDisputeView(dispute),
    events: events.map(toVendorDisputeEventView),
  })
}

/**
 * POST /vendor/disputes/:id — the vendor's answer.
 *
 * Recorded as evidence; it does not move the case. Letting a response advance
 * the status would let the party being complained about drive the process
 * they are the subject of. Only an admin resolves.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

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
    return res.json({ dispute: toVendorDisputeView(dispute) })
  } catch (err) {
    if (err instanceof DisputeStateError) {
      // "not the vendor on this dispute" must not confirm the id exists,
      // and neither may "dispute not found" read differently from it.
      if (/not the vendor|not found/.test(err.message)) {
        return res.status(404).json({ message: "Dispute not found" })
      }
      return res.status(409).json({ message: err.message })
    }
    log.error("[POST /vendor/disputes/:id] failed", err)
    return res.status(500).json({ message: "Failed to record response" })
  }
}
