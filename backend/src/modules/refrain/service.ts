import { MedusaService } from "@medusajs/framework/utils"
import { Bounty, BountySubmission } from "./models"
import {
  canTransition,
  validateBountyCreate,
  type BountyCreateInput,
  type BountyStatus,
} from "./policy"

class RefrainModuleService extends MedusaService({
  Bounty,
  BountySubmission,
}) {
  /**
   * Create a bounty in `draft` state. The poster must then call
   * `transitionBounty(id, "posted")` to make it visible — that
   * transition is where the EscrowAgreement is created and the
   * amount is locked.
   *
   * Inputs are validated against `policy.ts`'s
   * `validateBountyCreate`; any violation throws synchronously.
   */
  async createBounty(args: BountyCreateInput & { posted_by_member_id: string }) {
    if (!args.posted_by_member_id) {
      throw new Error("posted_by_member_id is required")
    }
    const validated = validateBountyCreate(args)

    const [row] = await this.createBounties([
      {
        posted_by_member_id: args.posted_by_member_id,
        title: validated.title,
        description: validated.description,
        amount_minor: validated.amount_minor,
        currency_code: validated.currency_code,
        pricing_mode: validated.pricing_mode,
        rights_mode: validated.rights_mode,
        review_window_days: validated.review_window_days,
        status: "draft",
      },
    ])
    return row
  }

  /**
   * Move a bounty to a new status, enforcing the allowed-transitions
   * map from `policy.ts`. Wrong transitions throw — the caller is
   * expected to map this to a 409/422 at the HTTP boundary.
   *
   * NOTE: side effects (creating an EscrowAgreement on
   * `draft -> posted`, releasing on `submitted -> accepted`, etc.)
   * are deferred to the workflow layer in a follow-up branch; this
   * service is the state-machine guard.
   */
  async transitionBounty(id: string, to: BountyStatus) {
    const existing = await this.retrieveBounty(id)
    if (!canTransition(existing.status as BountyStatus, to)) {
      throw new Error(
        `Illegal bounty transition: ${existing.status} -> ${to}`
      )
    }
    const now = new Date()
    const stamps: Record<string, Date> = {}
    if (to === "posted") stamps.posted_at = now
    if (to === "claimed") stamps.claimed_at = now
    if (to === "submitted") stamps.submitted_at = now
    if (["accepted", "rejected", "expired", "cancelled"].includes(to)) {
      stamps.resolved_at = now
    }
    const [updated] = await this.updateBounties([
      { id, status: to, ...stamps },
    ])
    return updated
  }
}

export default RefrainModuleService
