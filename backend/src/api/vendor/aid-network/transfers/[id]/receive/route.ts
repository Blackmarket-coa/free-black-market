import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AID_NETWORK_MODULE } from "../../../../../../modules/aid-network"
import type AidNetworkModuleService from "../../../../../../modules/aid-network/service"
import { getSellerId } from "../../../../quests/_helpers"
import { respondToServiceError } from "../../../_helpers"

interface ReceiveBody {
  received_qty: number
  expires_at?: string
  lot_code?: string
}

/**
 * POST /vendor/aid-network/transfers/:id/receive — book what actually arrived.
 *
 * `received_qty` may be less than what shipped; the shortfall stays visible on
 * the transfer rather than being reconciled away.
 */
export const POST = async (
  req: MedusaRequest<ReceiveBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as ReceiveBody)
  if (typeof b.received_qty !== "number" || !Number.isFinite(b.received_qty)) {
    return res.status(400).json({ message: "received_qty must be a number" })
  }
  if (b.expires_at && Number.isNaN(new Date(b.expires_at).getTime())) {
    return res.status(400).json({ message: "expires_at must be a valid date" })
  }

  const service = req.scope.resolve<AidNetworkModuleService>(AID_NETWORK_MODULE)

  try {
    const node_transfer = await service.receiveTransfer(
      sellerId,
      req.params.id,
      b.received_qty,
      { expires_at: b.expires_at ?? null, lot_code: b.lot_code ?? null }
    )
    res.json({ node_transfer })
  } catch (e) {
    if (respondToServiceError(e, res)) return
    throw e
  }
}
