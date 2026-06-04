import { MedusaService } from "@medusajs/framework/utils"
import { Cooperative, CooperativeMember, CooperativeListing } from "./models"
import { CooperativeMemberRole } from "./models/cooperative-member"

class CooperativeService extends MedusaService({
  Cooperative,
  CooperativeMember,
  CooperativeListing,
}) {
  /**
   * Join a cooperative as a member.
   *
   * Self-service membership so a coalition can grow without admin
   * intervention. Idempotent on (cooperative_id, producer_id): if an
   * active membership already exists it is returned unchanged; if a prior
   * membership was deactivated (the producer left), it is re-activated
   * rather than duplicated.
   */
  async joinCooperative(input: {
    cooperative_id: string
    producer_id: string
    role?: CooperativeMemberRole
  }) {
    const existing = await this.listCooperativeMembers({
      cooperative_id: input.cooperative_id,
      producer_id: input.producer_id,
    })

    const active = existing.find((m: any) => m.is_active)
    if (active) {
      return active
    }

    const reactivatable = existing[0]
    if (reactivatable) {
      const [member] = await this.updateCooperativeMembers([
        {
          id: reactivatable.id,
          is_active: true,
          suspended_at: null,
          suspension_reason: null,
          joined_at: new Date(),
        },
      ])
      return member
    }

    return this.createCooperativeMembers({
      cooperative_id: input.cooperative_id,
      producer_id: input.producer_id,
      role: input.role ?? CooperativeMemberRole.MEMBER,
      joined_at: new Date(),
      is_active: true,
    })
  }

  /**
   * Leave a cooperative. Soft-deactivates the membership so history and
   * revenue-share records are preserved. No-op if not a member.
   */
  async leaveCooperative(input: {
    cooperative_id: string
    producer_id: string
  }) {
    const existing = await this.listCooperativeMembers({
      cooperative_id: input.cooperative_id,
      producer_id: input.producer_id,
    })
    const active = existing.find((m: any) => m.is_active)
    if (!active) {
      return { left: false }
    }

    await this.updateCooperativeMembers([
      { id: active.id, is_active: false },
    ])
    return { left: true }
  }

  /**
   * List the active members of a cooperative.
   */
  async listActiveMembers(cooperative_id: string) {
    return this.listCooperativeMembers({
      cooperative_id,
      is_active: true,
    })
  }
}

export default CooperativeService
