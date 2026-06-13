import { createLogger } from "../../../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools/[id]/escrow")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../../../modules/demand-pool/service"
import { getCollectiveHawalaService } from "../../../../../../services/collective-hawala"

const escrowSchema = z.object({
  amount: z.number().positive(),
})

// POST /store/collective/demand-pools/:id/escrow (lock funds)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = escrowSchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    // Find participant
    const participants = await demandPoolService.listDemandParticipants({
      demand_post_id: id,
      customer_id: customerId,
    })
    if (participants.length === 0) {
      return res.status(400).json({ error: "Must join the demand pool first" })
    }

    const participant = participants[0]
    if (participant.escrow_locked) {
      return res.status(400).json({ error: "Funds already escrowed" })
    }

    const hawalaService = getCollectiveHawalaService(req.scope)
    const entry = await hawalaService.escrowParticipantFunds({
      demand_post_id: id,
      participant_id: participant.id,
      customer_id: customerId,
      amount: body.amount,
    })

    res.status(201).json({
      message: "Funds escrowed successfully",
      ledger_entry_id: entry.id,
      amount: body.amount,
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    log.error(`[POST escrow] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}

// DELETE /store/collective/demand-pools/:id/escrow (release funds)
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

    const participants = await demandPoolService.listDemandParticipants({
      demand_post_id: id,
      customer_id: customerId,
    })
    if (participants.length === 0) {
      return res.status(400).json({ error: "Not a participant" })
    }

    const hawalaService = getCollectiveHawalaService(req.scope)
    const entry = await hawalaService.releaseParticipantEscrow({
      demand_post_id: id,
      participant_id: participants[0].id,
      customer_id: customerId,
    })

    res.json({
      message: "Escrowed funds released",
      ledger_entry_id: entry.id,
    })
  } catch (error: any) {
    log.error(`[DELETE escrow] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
