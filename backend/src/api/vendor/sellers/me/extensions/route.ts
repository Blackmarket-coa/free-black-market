import { createLogger } from "../../../../../shared/logger"
const log = createLogger("api/vendor/sellers/me/extensions")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../../shared"
import { fetchSellerProfile } from "../../../../../shared/seller-profile"
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../../../modules/seller-extension/metadata-service"

/**
 * POST /vendor/sellers/me/extensions
 *
 * Update only the seller's enabled dashboard extensions.
 * This dedicated endpoint avoids payload-shape differences in
 * `/vendor/sellers/me` implementations across environments.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const body = (req.body ?? {}) as { enabled_extensions?: string[] | null }

    if (!("enabled_extensions" in body)) {
      return res.status(400).json({
        type: "invalid_data",
        message: "enabled_extensions is required",
      })
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const sellerExtensionModule = req.scope.resolve("sellerExtension")

    const { data: metadataRecords } = await query.graph({
      entity: "seller_metadata",
      fields: ["id"],
      filters: { seller_id: sellerId },
    })

    if (metadataRecords && metadataRecords.length > 0) {
      const metadataId = (metadataRecords[0] as { id: string }).id
      await updateSellerMetadataRecord(sellerExtensionModule as any, [
        { id: metadataId, enabled_extensions: body.enabled_extensions ?? null },
      ])
    } else {
      await createSellerMetadataRecord(sellerExtensionModule as any, [
        { seller_id: sellerId, enabled_extensions: body.enabled_extensions ?? null },
      ])
    }

    const seller = await fetchSellerProfile({
      req,
      sellerId,
      requestedFields: req.query.fields,
    })

    return res.json({ seller })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/sellers/me/extensions] Error:", errorMessage)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to update seller extensions",
    })
  }
}
