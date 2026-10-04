import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COLLECTIVE_CAMPAIGN_MODULE } from "../../../../../modules/collective-campaign"
import type CollectiveCampaignModuleService from "../../../../../modules/collective-campaign/service"
import { actorId, forbidden } from "../../../../../shared/community-read-access"

/**
 * The host-only check shared by the shared-goal write routes.
 *
 * The actor must be the campaign's HOST participant — the `seller_id` on the
 * row `createSharedGoalCampaign` wrote — not merely present (cf. the parent
 * route's `vendor_id = auth_context.actor_id` with no further check). A missing
 * campaign, a campaign that is not a shared goal and a non-host actor all get
 * the same `forbidden()` 403: the 404-then-403 split at `[id]/route.ts` is an
 * existence oracle and is not copied here (shared/community-read-access.ts).
 *
 * Returns the service when the actor may write, or `null` after a response has
 * been sent.
 */
export async function requireSharedGoalHost(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<CollectiveCampaignModuleService | null> {
  const actor = actorId(req)
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" })
    return null
  }

  const service = req.scope.resolve<CollectiveCampaignModuleService>(COLLECTIVE_CAMPAIGN_MODULE)
  const host = await service.getHostParticipant(req.params.id)
  if (!host || !host.seller_id || host.seller_id !== actor) {
    forbidden(res)
    return null
  }
  return service
}

export const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Unknown error"
}
