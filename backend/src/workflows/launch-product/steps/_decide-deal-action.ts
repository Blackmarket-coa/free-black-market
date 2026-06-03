import { CreatorApplicationStatus } from "../../../modules/creator-program/models/creator-application"
import { CreatorDealStatus } from "../../../modules/creator-program/models/creator-deal"

/**
 * Consent gate for the creator side of a launch.
 *
 * A launch must NEVER mint a deal + affiliate link on a creator's behalf — that
 * is the creator's decision to make (by applying to the program, or by claiming
 * the marketing bounty). This helper decides, purely from existing records,
 * whether the targeted creator has already consented:
 *
 *  - `reuse_deal` — an ACTIVE deal already exists for (vendor, creator); use it.
 *  - `open_deal`  — the creator has an APPROVED application; open a deal for it.
 *  - `invite`     — no prior consent; only record an invitation. No deal/link.
 */
export type DealAction =
  | { action: "reuse_deal"; dealId: string }
  | { action: "open_deal"; applicationId: string }
  | { action: "invite" }

export function decideDealAction(
  applications: Array<{ id: string; status: string }>,
  deals: Array<{ id: string; status: string }>
): DealAction {
  const activeDeal = deals.find((d) => d.status === CreatorDealStatus.ACTIVE)
  if (activeDeal) {
    return { action: "reuse_deal", dealId: activeDeal.id }
  }

  const approvedApp = applications.find(
    (a) => a.status === CreatorApplicationStatus.APPROVED
  )
  if (approvedApp) {
    return { action: "open_deal", applicationId: approvedApp.id }
  }

  return { action: "invite" }
}
