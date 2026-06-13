import { createLogger } from "../shared/logger"
const log = createLogger("links/producer-seller")
import { defineLink } from "@medusajs/framework/utils"
import ProducerModule from "../modules/producer"

/**
 * Link: Seller ↔ Producer (1:1)
 *
 * Links the MercurJS seller to our producer (farm profile) module.
 * This enables farm story, location, and other producer-specific fields
 * to be queried alongside the seller entity.
 *
 * Only applicable for sellers with vendor_type="producer".
 *
 * Usage in queries:
 *   query.graph({
 *     entity: "producer_seller",
 *     fields: ["producer_id", "producer.*"],
 *     filters: { seller_id: sellerId },
 *   })
 */

const LOG_PREFIX = "[Link: producer-seller]"

// Import MercurJS seller module with detailed logging
let SellerModule: any = null

try {
  SellerModule = require("@mercurjs/framework").SellerModule
  log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/framework`)
} catch (frameworkError: any) {
  try {
    SellerModule = require("@mercurjs/b2c-core/modules/seller").default
    log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/b2c-core/modules/seller`)
  } catch (b2cError: any) {
    log.error(`${LOG_PREFIX} Failed to load SellerModule:`)
    log.error(`${LOG_PREFIX}   @mercurjs/framework: ${frameworkError.message}`)
    log.error(`${LOG_PREFIX}   @mercurjs/b2c-core/modules/seller: ${b2cError.message}`)
    log.error(`${LOG_PREFIX} producer link will NOT be created`)
  }
}

// Define the link if SellerModule was loaded successfully
let producerSellerLink: ReturnType<typeof defineLink> | null = null

if (SellerModule) {
  try {
    if (!SellerModule.linkable?.seller) {
      throw new Error("SellerModule.linkable.seller is undefined")
    }
    if (!ProducerModule.linkable?.producer) {
      throw new Error("ProducerModule.linkable.producer is undefined")
    }

    producerSellerLink = defineLink(
      {
        linkable: SellerModule.linkable.seller,
        isList: false,
      },
      {
        linkable: ProducerModule.linkable.producer,
        isList: false,
      }
    )
    log.info(`${LOG_PREFIX} Link defined successfully: seller ↔ producer`)
  } catch (linkError: any) {
    log.error(`${LOG_PREFIX} Failed to define link: ${linkError.message}`)
    producerSellerLink = null
  }
}

export default producerSellerLink
