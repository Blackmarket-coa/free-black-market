import { MedusaService } from "@medusajs/framework/utils"
import { KarmaLedgerEntry, MutualAidPost } from "./models"
import {
  validateThresholdPostCreate,
  type ThresholdPostCreateInput,
} from "./policy"

class ThresholdModuleService extends MedusaService({
  MutualAidPost,
  KarmaLedgerEntry,
}) {
  /**
   * Create a Threshold mutual-aid post.
   *
   * Inputs run through `validateThresholdPostCreate` which enforces
   * the no-price invariant; any attempt to include a price-like
   * field throws synchronously. The caller is expected to map this
   * to a 400/422 at the HTTP boundary.
   */
  async createMutualAidPost(args: ThresholdPostCreateInput) {
    const validated = validateThresholdPostCreate(args)
    const [row] = await this.createMutualAidPosts([
      {
        type: validated.type,
        title: validated.title,
        description: validated.description,
        posted_by_member_id: validated.posted_by_member_id,
        latitude: validated.latitude,
        longitude: validated.longitude,
        visibility_radius_km: validated.visibility_radius_km,
        status: "active",
      },
    ])
    return row
  }

  /**
   * Compute a member's current Karma balance by summing every entry
   * keyed to their member_id. Pure; no caching here so the result is
   * always live.
   */
  async getKarmaBalance(memberId: string): Promise<number> {
    const entries = await this.listKarmaLedgerEntries({
      member_id: memberId,
    })
    return entries.reduce(
      (acc: number, entry: { delta: number | string }) =>
        acc + Number(entry.delta),
      0
    )
  }

  /**
   * Append a Karma entry. delta is signed: positive for contributions
   * (returned a tool), negative for borrowing.
   */
  async appendKarmaEntry(args: {
    member_id: string
    post_id?: string | null
    delta: number
    reason: string
  }) {
    if (!args.member_id) throw new Error("member_id is required")
    if (!args.reason || args.reason.trim().length === 0) {
      throw new Error("Karma entries must include a reason")
    }
    if (
      typeof args.delta !== "number" ||
      !Number.isFinite(args.delta) ||
      !Number.isInteger(args.delta)
    ) {
      throw new Error("Karma delta must be an integer")
    }
    const [row] = await this.createKarmaLedgerEntries([
      {
        member_id: args.member_id,
        post_id: args.post_id ?? null,
        delta: args.delta,
        reason: args.reason.trim(),
      },
    ])
    return row
  }
}

export default ThresholdModuleService
