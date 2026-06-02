import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BARGAINING_MODULE } from "../../../../../../modules/bargaining"
import BargainingModuleService from "../../../../../../modules/bargaining/service"

const postMessageSchema = z.object({
  message: z.string().min(1),
  message_type: z.enum(["COMMENT", "COUNTER", "QUESTION", "UPDATE"]).optional(),
  proposal_id: z.string().optional(),
  parent_message_id: z.string().optional(),
  attachment_urls: z.array(z.string()).optional(),
})

// GET /store/collective/bargaining-groups/:id/threads
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const proposalId = req.query.proposal_id as string | undefined

  try {
    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const threads = await bargainingService.getThreads(id, proposalId)
    res.json({ threads })
  } catch (error: any) {
    console.error(`[GET threads] Error:`, error.message)
    res.status(500).json({ error: "Failed to retrieve threads" })
  }
}

// POST /store/collective/bargaining-groups/:id/threads
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const body = postMessageSchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const bargainingService = req.scope.resolve<BargainingModuleService>(
      BARGAINING_MODULE
    )

    const thread = await bargainingService.postMessage({
      group_id: id,
      proposal_id: body.proposal_id,
      author_id: customerId,
      author_type: "CUSTOMER",
      message: body.message,
      message_type: body.message_type,
      parent_message_id: body.parent_message_id,
      attachment_urls: body.attachment_urls,
    })

    res.status(201).json({ thread })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    console.error(`[POST thread] Error:`, error.message)
    res.status(400).json({ error: error.message })
  }
}
