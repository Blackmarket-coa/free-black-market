import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/sellers/me")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../shared"
import { fetchSellerProfile } from "../../../../shared/seller-profile"
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../../modules/seller-extension/metadata-service"

type SellerModuleLike = {
  updateSellers: (data: Array<Record<string, unknown>>) => Promise<unknown>
}

/**
 * GET /vendor/sellers/me
 *
 * Get the currently authenticated seller's profile information.
 * This endpoint is called by the vendor panel to fetch the logged-in seller's data.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  // Get seller ID from authentication context
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const seller = await fetchSellerProfile({
      req,
      sellerId,
      requestedFields: req.query.fields,
    })

    if (!seller) {
      return res.status(404).json({
        message: "Seller not found",
        type: "not_found",
      })
    }
    return res.json({ seller })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/sellers/me] Error:", errorMessage)
    return res.status(500).json({
      message: "Failed to fetch seller profile",
      type: "server_error",
    })
  }
}

/**
 * POST /vendor/sellers/me
 *
 * Update the currently authenticated seller's profile information.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  // Get seller ID from authentication context
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const body = req.body as Record<string, unknown>

    // Separate seller fields from seller_metadata fields
    const sellerUpdateFields = [
      "name", "description", "phone", "email", "handle", "photo",
      "address_line", "postal_code", "city", "country_code", "tax_id", "metadata"
    ]
    const metadataUpdateFields = ["vendor_type", "website_url", "social_links", "storefront_links", "certifications", "enabled_extensions"]

    const sellerUpdate: Record<string, unknown> = {}
    const metadataUpdate: Record<string, unknown> = {}

    // Sort fields into appropriate update objects
    for (const [key, value] of Object.entries(body)) {
      if (sellerUpdateFields.includes(key)) {
        sellerUpdate[key] = value
      } else if (metadataUpdateFields.includes(key)) {
        metadataUpdate[key] = value
      } else if (key === "media") {
        // Map media to photo
        sellerUpdate["photo"] = value
      }
    }

    // Get the seller module to update seller data
    // Note: In Medusa, we typically use workflows for updates, but for direct updates
    // we can use the module service
    const sellerModule = req.scope.resolve("seller") as SellerModuleLike

    // Update seller if there are fields to update
    if (Object.keys(sellerUpdate).length > 0) {
      await sellerModule.updateSellers([
        { id: sellerId, ...sellerUpdate }
      ])
    }

    // Update seller_metadata if there are metadata fields to update
    if (Object.keys(metadataUpdate).length > 0) {
      // First, find the existing seller_metadata record
      const { data: metadataRecords } = await query.graph({
        entity: "seller_metadata",
        fields: ["id"],
        filters: { seller_id: sellerId },
      })

      const sellerExtensionModule = req.scope.resolve("sellerExtension")

      if (metadataRecords && metadataRecords.length > 0) {
        // Update existing metadata
        const metadataId = (metadataRecords[0] as { id: string }).id
        await updateSellerMetadataRecord(sellerExtensionModule as any, [
          { id: metadataId, ...metadataUpdate },
        ])
      } else {
        // Create new metadata record
        await createSellerMetadataRecord(sellerExtensionModule as any, [
          { seller_id: sellerId, ...metadataUpdate },
        ])
      }
    }

    const seller = await fetchSellerProfile({
      req,
      sellerId,
      requestedFields: req.query.fields,
    })

    if (!seller) {
      return res.status(404).json({
        message: "Seller not found after update",
        type: "not_found",
      })
    }
    return res.json({ seller })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/sellers/me] Error:", errorMessage)
    return res.status(500).json({
      message: "Failed to update seller profile",
      type: "server_error",
    })
  }
}
