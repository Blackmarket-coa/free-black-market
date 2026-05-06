import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../modules/creator-program/service"
import { CreatorProgramStatus } from "../../../../../modules/creator-program/models"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const list = await service.listCreatorPrograms({ id })
  const program = list[0]
  if (!program) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }

  // Don't surface drafts publicly
  if (program.status === CreatorProgramStatus.DRAFT) {
    return res.status(404).json({ message: "Program not available", type: "not_found" })
  }

  return res.status(200).json({ program })
}
