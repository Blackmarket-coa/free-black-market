/**
 * Wellness practitioner KARMA — built on the existing `progression` module,
 * exactly like `progression/grower-karma.ts`. A practitioner is a MercurJS
 * seller; XP is recorded on the PRODUCER track against the seller's primary
 * member id. We do NOT introduce a new quest/KARMA store — the wellness quest
 * definitions surface through the same engine.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../progression"
import type ProgressionModuleService from "../progression/service"
import { Stance } from "../progression/stance"

export type WellnessKarmaEventType =
  | "booking_completed"
  | "booking_first_session"
  | "booking_no_show"
  | "class_completed"
  | "class_sold_out"
  | "digital_first_download"
  | "membership_first_signup"
  | "membership_10_active"
  | "review_five_star"
  | "client_zero_noshow_month"
  | "connect_first_embed_purchase"
  | "intake_100_percent_month"
  | "blackout_community_post"
  | "mrr_500_milestone"
  | "mrr_1000_milestone"
  | "referral_practitioner"

/** KARMA (PRODUCER XP) delta per wellness event. Negative for penalties. */
export const WELLNESS_KARMA_DELTAS: Record<WellnessKarmaEventType, number> = {
  booking_completed: 1,
  booking_first_session: 20,
  booking_no_show: -3,
  class_completed: 8,
  class_sold_out: 25,
  digital_first_download: 15,
  membership_first_signup: 30,
  membership_10_active: 50,
  review_five_star: 15,
  client_zero_noshow_month: 20,
  connect_first_embed_purchase: 25,
  intake_100_percent_month: 15,
  blackout_community_post: 2,
  mrr_500_milestone: 40,
  mrr_1000_milestone: 75,
  referral_practitioner: 40,
}

export interface EmitWellnessKarmaInput {
  seller_id: string
  event_type: WellnessKarmaEventType
  /** Multiplier for per-unit events. Default 1. */
  units?: number
  /** Stable id so the karma_event partial-unique dedup prevents double counts. */
  reference_id: string
  metadata?: Record<string, unknown>
}

type QueryLike = { graph: (args: Record<string, unknown>) => Promise<{ data: any[] }> }

export class WellnessKarmaService {
  private readonly container: MedusaContainer

  constructor(container: MedusaContainer) {
    this.container = container
  }

  private get query(): QueryLike {
    return this.container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  }

  private get progression(): ProgressionModuleService {
    return this.container.resolve(PROGRESSION_MODULE) as ProgressionModuleService
  }

  /** Resolve the progression subject (primary member id) for a seller. */
  async resolvePractitionerCustomerId(sellerId: string): Promise<string | null> {
    try {
      const { data: sellers } = await this.query.graph({
        entity: "seller",
        fields: ["id", "members.id"],
        filters: { id: sellerId },
      })
      return sellers?.[0]?.members?.[0]?.id ?? null
    } catch {
      return null
    }
  }

  /**
   * Award wellness KARMA (PRODUCER-track XP). No-op (returns false) if the
   * subject can't be resolved, so subscriber callers stay non-fatal.
   */
  async emitWellnessKarmaEvent(input: EmitWellnessKarmaInput): Promise<boolean> {
    const customerId = await this.resolvePractitionerCustomerId(input.seller_id)
    if (!customerId) return false

    const units = input.units && input.units > 0 ? input.units : 1
    const amount = WELLNESS_KARMA_DELTAS[input.event_type] * units

    await this.progression.recordXpEvent({
      customer_id: customerId,
      role: Stance.PRODUCER,
      amount,
      reason: `wellness:${input.event_type}`,
      source_module: "wellness",
      source_id: input.reference_id,
      metadata: {
        ...input.metadata,
        wellness_seller_id: input.seller_id,
        event_type: input.event_type,
      },
    })
    return true
  }
}
