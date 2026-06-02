import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"

const joinSchema = z.object({
  quantity_committed: z.number().int().positive(),
  price_willing_to_pay: z.number().positive().optional(),
})

// POST /store/collective/demand-pools/:id/join
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = joinSchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const participant = await demandPoolService.joinDemandPool({
      demand_post_id: id,
      customer_id: customerId,
      quantity_committed: body.quantity_committed,
      price_willing_to_pay: body.price_willing_to_pay,
    })

    res.status(201).json({ participant })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    console.error(`[POST /store/collective/demand-pools/${id}/join] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}

// DELETE /store/collective/demand-pools/:id/join (withdraw)
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    await demandPoolService.withdrawFromPool(id, customerId)
    res.json({ message: "Successfully withdrawn from demand pool" })
  } catch (error: any) {
    console.error(`[DELETE /store/collective/demand-pools/${id}/join] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
