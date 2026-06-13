import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/collective/buyer-networks/[id]/join")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BUYER_NETWORK_MODULE } from "../../../../../../modules/buyer-network"
import BuyerNetworkModuleService from "../../../../../../modules/buyer-network/service"

const joinSchema = z.object({
  display_name: z.string().optional(),
  business_name: z.string().optional(),
  business_type: z.string().optional(),
  referrer_id: z.string().optional(),
})

// POST /store/collective/buyer-networks/:id/join
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = joinSchema.parse(req.body || {})
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    const member = await networkService.joinNetwork({
      network_id: id,
      customer_id: customerId,
      display_name: body.display_name,
      business_name: body.business_name,
      business_type: body.business_type,
      referrer_id: body.referrer_id,
    })

    res.status(201).json({ member })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error(`[POST join network] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}

// DELETE /store/collective/buyer-networks/:id/join (leave)
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const networkService = req.scope.resolve<BuyerNetworkModuleService>(
      BUYER_NETWORK_MODULE
    )

    await networkService.leaveNetwork(id, customerId)
    res.json({ message: "Successfully left network" })
  } catch (error: any) {
    log.error(`[DELETE leave network] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
