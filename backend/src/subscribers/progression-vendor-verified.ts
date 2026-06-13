import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/progression-vendor-verified")
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PROGRESSION_MODULE } from "../modules/progression"
import { Stance } from "../modules/progression/stance"
import type ProgressionModuleService from "../modules/progression/service"

type VendorVerifiedEventPayload = { seller_id: string }

/**
 * Award PRODUCER XP and mirror the verification trust score when a vendor is
 * verified.
 *
 * Identity note: the progression character sheet is keyed by a single "user"
 * id. For producers we use the seller's *primary member* id as that key — the
 * person who operates the storefront. This is the seller-side identity for the
 * gamification layer. Isolated by try/catch; additive only.
 */
export default async function progressionVendorVerified({
  event: { data },
  container,
}: SubscriberArgs<VendorVerifiedEventPayload>) {
  try {
    const sellerId = data.seller_id
    if (!sellerId) return

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const progression = container.resolve(
      PROGRESSION_MODULE
    ) as ProgressionModuleService

    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: ["id", "members.id"],
      filters: { id: sellerId },
    })

    const memberId = sellers?.[0]?.members?.[0]?.id
    if (!memberId) return

    // Flat PRODUCER XP bonus for reaching verified status.
    await progression.recordXpEvent({
      customer_id: memberId,
      role: Stance.PRODUCER,
      amount: 250,
      reason: "verified",
      source_module: "vendor_verification",
      source_id: sellerId,
    })

    // Mirror the seller's trust score onto the sheet snapshot.
    await progression.recomputeAggregates(memberId, query as never, sellerId)
  } catch (error) {
    log.error(
      `[progression-vendor-verified] Failed for seller ${data.seller_id}:`,
      error
    )
  }
}

export const config: SubscriberConfig = {
  event: "vendor.verified",
}
