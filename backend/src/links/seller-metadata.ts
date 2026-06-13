import { createLogger } from "../shared/logger"
const log = createLogger("links/seller-metadata")
import { defineLink } from "@medusajs/framework/utils"
import SellerExtensionModule from "../modules/seller-extension"

/**
 * Link: Seller ↔ Seller Metadata (1:1)
 *
 * Links the MercurJS seller to our extension metadata.
 * This enables vendor_type, certifications, and other extended fields
 * to be queried alongside the seller entity.
 *
 * Usage in queries:
 *   query.graph({
 *     entity: "seller",
 *     fields: ["*", "seller_metadata.*"],
 *   })
 *
 * TROUBLESHOOTING:
 * If this link fails to load, check:
 * 1. @mercurjs/b2c-core is installed and configured in medusa-config.ts
 * 2. The seller-extension module is registered in medusa-config.ts
 * 3. Run `npx medusa db:migrate` to sync link tables
 */

const LOG_PREFIX = "[Link: seller-metadata]"

// Import MercurJS seller module with detailed logging
let SellerModule: any = null
let loadError: string | null = null

try {
  // Try the newer @mercurjs/framework export first
  SellerModule = require("@mercurjs/framework").SellerModule
  log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/framework`)
} catch (frameworkError: any) {
  try {
    // Fallback to @mercurjs/b2c-core direct import
    SellerModule = require("@mercurjs/b2c-core/modules/seller").default
    log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/b2c-core/modules/seller`)
  } catch (b2cError: any) {
    loadError = `
      Failed to load SellerModule:
      - @mercurjs/framework: ${frameworkError.message}
      - @mercurjs/b2c-core/modules/seller: ${b2cError.message}
    `.trim()
    log.error(`${LOG_PREFIX} ${loadError}`)
    log.error(`${LOG_PREFIX} seller_metadata link will NOT be created`)
    log.error(`${LOG_PREFIX} Queries like "seller.seller_metadata.*" will fail`)
  }
}

// Define the link if SellerModule was loaded successfully
let sellerMetadataLink: ReturnType<typeof defineLink> | null = null

if (SellerModule) {
  try {
    // Verify the linkable property exists
    if (!SellerModule.linkable?.seller) {
      throw new Error("SellerModule.linkable.seller is undefined")
    }
    if (!SellerExtensionModule.linkable?.sellerMetadata) {
      throw new Error("SellerExtensionModule.linkable.sellerMetadata is undefined")
    }

    sellerMetadataLink = defineLink(
      {
        linkable: SellerModule.linkable.seller,
        isList: false,
      },
      {
        linkable: SellerExtensionModule.linkable.sellerMetadata,
        isList: false,
      }
    )
    log.info(`${LOG_PREFIX} Link defined successfully: seller ↔ seller_metadata`)
  } catch (linkError: any) {
    log.error(`${LOG_PREFIX} Failed to define link: ${linkError.message}`)
    sellerMetadataLink = null
  }
}

export default sellerMetadataLink
