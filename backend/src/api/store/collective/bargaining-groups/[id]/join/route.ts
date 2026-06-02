import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARGAINING_MODULE } from "../../../../../../modules/bargaining"
import BargainingModuleService from "../../../../../../modules/bargaining/service"

const joinSchema = z.object({
  quantity_needed: z.number().int().positive().optional(),
  budget: z.number().positive().optional(),
  specific_requirements: z.record(z.string(), z.unknown()).optional(),
})

// POST /store/collective/bargaining-groups/:id/join
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = joinSchema.parse(req.body || {})
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const member = await bargainingService.joinGroup({
      group_id: id,
      customer_id: customerId,
      quantity_needed: body.quantity_needed,
      budget: body.budget,
      specific_requirements: body.specific_requirements,
    })

    res.status(201).json({ member })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    console.error(`[POST /store/collective/bargaining-groups/${id}/join] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}

// DELETE /store/collective/bargaining-groups/:id/join (leave)
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    await bargainingService.leaveGroup(id, customerId)
    res.json({ message: "Successfully left bargaining group" })
  } catch (error: any) {
    console.error(`[DELETE /store/collective/bargaining-groups/${id}/join] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
