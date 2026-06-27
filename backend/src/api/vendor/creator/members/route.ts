import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { listCreatorMembers } from "../../../../lib/creator-hub"

/**
 * GET /vendor/creator/members
 * The authenticated creator's members (derived from their subscriptions), with
 * each member's Blackout sync status. Powers the Memberships page table.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const members = await listCreatorMembers(req.scope, sellerId)
  return res.json({ members, count: members.length })
}
