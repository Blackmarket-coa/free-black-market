import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COOPERATIVE_MODULE } from "../../../../../modules/cooperative"
import type CooperativeService from "../../../../../modules/cooperative/service"

/**
 * POST /store/cooperatives/:handle/join
 * Self-service coalition membership. Idempotent — re-joining returns the
 * existing membership rather than creating a duplicate.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { handle } = req.params

  try {
    const producerId = (req as any).auth_context?.actor_id
    if (!producerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const cooperativeService =
      req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)

    const coops = await cooperativeService.listCooperatives({ handle })
    const coop = coops[0]
    if (!coop) {
      return res.status(404).json({ message: "Cooperative not found" })
    }
    if (!coop.is_active) {
      return res.status(400).json({ error: "Cooperative is not active" })
    }

    const member = await cooperativeService.joinCooperative({
      cooperative_id: coop.id,
      producer_id: producerId,
    })

    return res.status(201).json({ member })
  } catch (error: any) {
    console.error(`[POST /store/cooperatives/${handle}/join] Error:`, error.message)
    return res.status(400).json({ error: error.message })
  }
}

/**
 * DELETE /store/cooperatives/:handle/join
 * Leave the coalition (soft-deactivates membership).
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { handle } = req.params

  try {
    const producerId = (req as any).auth_context?.actor_id
    if (!producerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const cooperativeService =
      req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)

    const coops = await cooperativeService.listCooperatives({ handle })
    const coop = coops[0]
    if (!coop) {
      return res.status(404).json({ message: "Cooperative not found" })
    }

    const result = await cooperativeService.leaveCooperative({
      cooperative_id: coop.id,
      producer_id: producerId,
    })

    return res.status(200).json(result)
  } catch (error: any) {
    console.error(`[DELETE /store/cooperatives/${handle}/join] Error:`, error.message)
    return res.status(400).json({ error: error.message })
  }
}
