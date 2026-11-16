import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../modules/creator-program/service"
import {
  isPubliclyReadableProgram,
  toPublicProgram,
  type PublicProgramSource,
} from "../public-program"

/**
 * GET /v1/marketplace/programs/:id
 *
 * Public detail of a program the public list can show: the same projection
 * (`toPublicProgram`), plus its status, for the same program types. A draft,
 * an invite-only or sponsored program, and an id that does not exist are one
 * 404, so the route does not say which program ids are real.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const id = (req.params as { id?: string })?.id
  if (!id) {
    return res.status(400).json({ message: "Missing id", type: "invalid_request" })
  }

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const list = (await service.listCreatorPrograms({ id })) as unknown as PublicProgramSource[]
  const program = list[0]

  if (!isPubliclyReadableProgram(program)) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }

  return res.status(200).json({
    program: { ...toPublicProgram(program), status: program.status },
  })
}
