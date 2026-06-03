import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COOPERATIVE_MODULE } from "../../../../../modules/cooperative"
import type CooperativeService from "../../../../../modules/cooperative/service"

/**
 * GET /store/cooperatives/:handle/members
 * Public member list for a coalition, so a coalition can present itself
 * and function without admin intervention.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { handle } = req.params

  const cooperativeService =
    req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)

  const coops = await cooperativeService.listCooperatives({ handle })
  const coop = coops[0]
  if (!coop) {
    return res.status(404).json({ message: "Cooperative not found" })
  }

  const members = await cooperativeService.listActiveMembers(coop.id)

  return res.status(200).json({
    cooperative: { id: coop.id, handle: coop.handle, name: coop.name },
    members: members.map((m: any) => ({
      id: m.id,
      producer_id: m.producer_id,
      role: m.role,
      membership_number: m.membership_number,
      joined_at: m.joined_at,
    })),
    count: members.length,
  })
}
