import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/seller-created-matrix")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import {
  getMatrixService,
  GOVERNANCE_POWER_LEVEL,
} from "../shared/matrix-service"

type SellerModuleLike = {
  retrieveSeller: (
    sellerId: string,
    options?: { relations?: string[] }
  ) => Promise<{
    handle?: string | null
    name?: string | null
    members?: Array<{ email?: string | null }>
  } | null>
}

/**
 * Subscriber: Seller Created - Matrix (Blackout) Integration
 *
 * Provisions a Matrix account for sellers/vendors when they are created, creates
 * their vendor room, and adds them to both the vendor room and the community room.
 */
export default async function sellerCreatedMatrixHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const sellerId = event.data.id

  if (!sellerId) {
    log.warn("[sellerCreated Matrix] Event received without seller ID")
    return
  }

  log.info(`[sellerCreated Matrix] Processing seller ${sellerId}`)

  try {
    const matrixService = getMatrixService()

    if (!matrixService) {
      log.info("[sellerCreated Matrix] Matrix not configured, skipping")
      return
    }

    const sellerService = container.resolve(SELLER_MODULE) as SellerModuleLike
    const seller = await sellerService.retrieveSeller(sellerId, {
      relations: ["members"],
    })

    if (!seller || !seller.members || seller.members.length === 0) {
      log.warn(`[sellerCreated Matrix] Seller ${sellerId} not found or has no members`)
      return
    }

    const member = seller.members[0]
    if (!member.email) {
      log.warn(`[sellerCreated Matrix] Seller member has no email`)
      return
    }

    const displayName = seller.name || member.email
    const { mxid } = await matrixService.ensureUser(
      seller.handle || member.email.split("@")[0],
      displayName,
      { email: member.email }
    )

    const vendorAlias = `vendor-${seller.handle || sellerId}`
    await matrixService.ensureRoom({
      alias: vendorAlias,
      name: `${seller.name || "Vendor"} Channel`,
      invite: [mxid],
      powerLevels: { [mxid]: GOVERNANCE_POWER_LEVEL.vendor },
    })

    await matrixService.invite(
      `#${matrixService.generalRoomAlias()}:${matrixService.getServerName()}`,
      mxid
    )

    log.info(`[sellerCreated Matrix] Provisioned Matrix account and room for vendor: ${mxid}`)
  } catch (error: any) {
    log.error(`[sellerCreated Matrix] Failed for seller ${sellerId}:`, error.message)
    // Don't throw - this is a non-critical enhancement
  }
}

export const config: SubscriberConfig = {
  event: "sellerCreated",
}
