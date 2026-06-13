import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/vendor-verified")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendVendorAcceptedNotificationWorkflow } from "../workflows/send-vendor-accepted-notification"

/**
 * Event payload for vendor verification
 */
type VendorVerifiedEventPayload = {
  seller_id: string
}

/**
 * Subscriber: Vendor Verified
 * 
 * Sends an automated email notification when a vendor account is verified/approved.
 * This subscriber listens to the "vendor.verified" event emitted when an admin
 * sets verified=true on seller metadata.
 */
export default async function vendorVerifiedHandler({
  event,
  container,
}: SubscriberArgs<VendorVerifiedEventPayload>) {
  const sellerId = event.data.seller_id

  if (!sellerId) {
    log.warn("vendor.verified event received without seller_id")
    return
  }

  log.info(`Processing vendor verification notification for seller ${sellerId}`)

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Get seller information including member details
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: [
        "id",
        "name",
        "members.id",
        "members.name",
        "members.email",
      ],
      filters: {
        id: sellerId,
      },
    })

    if (!sellers || sellers.length === 0) {
      log.error(`Seller ${sellerId} not found for verification notification`)
      return
    }

    const seller = sellers[0]
    
    // Get the first member (usually the primary account holder)
    const primaryMember = seller.members?.[0]
    
    if (!primaryMember?.email) {
      log.error(`No member with email found for seller ${sellerId}`)
      return
    }

    // Send the notification
    await sendVendorAcceptedNotificationWorkflow.run({
      container,
      input: {
        seller_id: sellerId,
        seller_name: seller.name || "Your Business",
        member_email: primaryMember.email,
        member_name: primaryMember.name || primaryMember.email.split("@")[0],
      },
    })

    log.info(`Vendor acceptance notification sent to ${primaryMember.email}`)
  } catch (error) {
    log.error(`Failed to send vendor verification notification for ${sellerId}:`, error)
    // Don't throw - notification failure shouldn't break the verification flow
  }
}

export const config: SubscriberConfig = {
  event: "vendor.verified",
}
