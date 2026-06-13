import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/seller-created")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createSellerMetadataWorkflow } from "../workflows/create-seller-metadata"
import { VendorType } from "../modules/seller-extension/models/seller-metadata"
import { SELLER_EXTENSION_MODULE } from "../modules/seller-extension"
import SellerExtensionService from "../modules/seller-extension/service"

/**
 * Subscriber: Seller Created
 *
 * Automatically creates seller_metadata when a new seller is created.
 * This ensures every seller has a vendor_type (defaults to PRODUCER).
 * Note: If metadata was already created (e.g., by admin approval endpoint),
 * this subscriber will skip creation to avoid duplicates.
 */
export default async function sellerCreatedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const sellerId = event.data.id

  if (!sellerId) {
    log.warn("sellerCreated event received without seller ID")
    return
  }

  log.info(`[sellerCreated subscriber] Checking metadata for seller ${sellerId}`)

  try {
    // Check if metadata already exists
    const sellerExtensionService: SellerExtensionService = container.resolve(
      SELLER_EXTENSION_MODULE
    )

    const existingMetadata = await sellerExtensionService.listSellerMetadatas({
      seller_id: sellerId,
    })

    if (existingMetadata && existingMetadata.length > 0) {
      log.info(`[sellerCreated subscriber] Metadata already exists for seller ${sellerId}, skipping creation`)
      return
    }

    // Create metadata if it doesn't exist
    log.info(`[sellerCreated subscriber] Creating metadata for seller ${sellerId}`)

    const { result } = await createSellerMetadataWorkflow.run({
      container,
      input: {
        seller_id: sellerId,
        vendor_type: VendorType.PRODUCER,
      },
    })

    log.info(`[sellerCreated subscriber] Seller metadata created: ${result.seller_metadata.id}`)
  } catch (error) {
    log.error(`[sellerCreated subscriber] Failed to create seller metadata for ${sellerId}:`, error)
    throw error
  }
}

export const config: SubscriberConfig = {
  event: "sellerCreated",
}
