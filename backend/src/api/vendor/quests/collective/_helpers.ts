import type { MedusaRequest } from "@medusajs/framework/http"
import { VENDOR_QUEST_MODULE } from "../../../../modules/vendor-quest"
import type VendorQuestModuleService from "../../../../modules/vendor-quest/service"
import { buildSubstrate } from "../../../../modules/vendor-quest/substrate/build"
import { getQuestDefinition } from "../../../../modules/vendor-quest/definitions"

/**
 * Build the aggregate evaluation for a collective quest from ONLY the members
 * who consent to every required scope. Each consenting member's substrate is
 * built individually and combined; non-consenting members (and non-members) are
 * never read, so one vendor's records never leak to another.
 */
export async function evaluateCollectiveFromConsent(
  req: MedusaRequest,
  collective: { id: string; quest_key: string }
) {
  const service = req.scope.resolve<VendorQuestModuleService>(VENDOR_QUEST_MODULE)
  const def = getQuestDefinition(collective.quest_key)
  if (!def) throw new Error(`Unknown quest '${collective.quest_key}'`)

  const requiredScopes = def.requiredConsentScopes ?? []
  const memberIds = await service.getConsentedMemberIds(collective.id, requiredScopes)

  // Build each consenting member's substrate (and no one else's).
  const substrates: Awaited<ReturnType<typeof buildSubstrate>>[] = []
  for (const sellerId of memberIds) {
    substrates.push(await buildSubstrate(sellerId, req.scope))
  }

  if (substrates.length === 0) {
    return {
      required_scopes: requiredScopes,
      consented_member_ids: [],
      aggregate: null,
      evaluation: null,
    }
  }

  const { aggregate, evaluation } = service.evaluateCollective(
    collective.quest_key,
    substrates,
    memberIds
  )
  return {
    required_scopes: requiredScopes,
    consented_member_ids: memberIds,
    aggregate,
    evaluation,
  }
}
