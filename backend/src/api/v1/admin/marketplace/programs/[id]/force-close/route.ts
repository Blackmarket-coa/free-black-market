import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { CREATOR_PROGRAM_MODULE } from "../../../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../../../modules/creator-program/service"

const Schema = z.object({
  reason: z.string().min(2).max(2000),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }
  const parsed = Schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const list = await service.listCreatorPrograms({ id })
  if (list.length === 0) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }
  const updated = await service.closeProgram(id, parsed.data.reason)
  return res.status(200).json({ program: updated })
}
