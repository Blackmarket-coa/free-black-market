import type { MedusaRequest } from "@medusajs/framework/http"
import { COOPERATIVE_MODULE } from "../../../../modules/cooperative"
import type CooperativeService from "../../../../modules/cooperative/service"
import type { CollectiveCoalitionInfo } from "../../../../modules/vendor-quest/types"

/**
 * The Blackout coalition behind a quest collective, or null when there isn't
 * one. Only the coalition-only quest (Q16) reads the result; every other
 * collective quest evaluates identically with or without it.
 *
 * Two ways a collective names its coalition, in order:
 *
 *  1. `metadata.cooperative_id` on the collective — explicit, unambiguous, and
 *     what the UI sets when a coalition starts the quest.
 *  2. The owner's own cooperative membership, used only when it resolves to
 *     exactly ONE coalition-linked cooperative. A vendor who belongs to two
 *     coalitions gets null rather than a guess: opening a joint-drive gate on
 *     the wrong coalition's drives would be worse than leaving it shut.
 */
export async function resolveCollectiveCoalition(
  req: MedusaRequest,
  collective: { owner_seller_id: string; metadata?: Record<string, unknown> | null }
): Promise<CollectiveCoalitionInfo | null> {
  const service = req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)

  const explicitId = collective.metadata?.["cooperative_id"]
  let cooperative: Record<string, unknown> | undefined
  if (typeof explicitId === "string" && explicitId.length > 0) {
    const [row] = await service.listCooperatives({ id: explicitId })
    cooperative = row
  } else {
    const memberships = await service.listCooperativeMembers({
      seller_id: collective.owner_seller_id,
      is_active: true,
    })
    const cooperativeIds = [
      ...new Set(
        memberships
          .map((m: { cooperative_id?: string | null }) => m.cooperative_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ]
    if (cooperativeIds.length === 0) return null
    const rows = await service.listCooperatives({ id: cooperativeIds })
    const linked = rows.filter(
      (r: { blackout_coalition_id?: string | null }) =>
        typeof r.blackout_coalition_id === "string" && r.blackout_coalition_id.length > 0
    )
    if (linked.length !== 1) return null
    cooperative = linked[0]
  }

  const coalitionId = cooperative?.["blackout_coalition_id"]
  if (typeof coalitionId !== "string" || coalitionId.length === 0) return null

  return {
    coalition_id: coalitionId,
    drives_completed: numeric(cooperative?.["coalition_drives_completed"]),
    contributing_members: numeric(cooperative?.["coalition_contributing_members"]),
    raised_cents: numeric(cooperative?.["coalition_drive_raised_cents"]),
  }
}

/** A BIGINT column comes back as a string from some drivers; coerce once here. */
function numeric(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
