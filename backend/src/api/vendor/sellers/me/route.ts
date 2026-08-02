import { createLogger } from "../../../../shared/logger"
import type SellerExtensionService from "../../../../modules/seller-extension/service"
const log = createLogger("api/vendor/sellers/me")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../shared"
import { fetchSellerProfile } from "../../../../shared/seller-profile"
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../../modules/seller-extension/metadata-service"
import { VendorType } from "../../../../modules/seller-extension/models/seller-metadata"
import { PLUGIN_REGISTRY_MODULE } from "../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../modules/plugin-registry/service"
import {
  UI_FEATURE_KEYS,
  findUnknownExtensionKeys,
} from "../../../../shared/extension-keys"

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

    // This route writes `vendor_type` and `enabled_extensions` through a
    // passthrough body schema, so both need validating here as well as on the
    // dedicated extensions endpoint — otherwise the allowlist there is simply
    // routed around. Validate before any write so a rejected payload leaves
    // the seller row untouched.
    if ("vendor_type" in metadataUpdate) {
      const submitted = metadataUpdate.vendor_type
      const allowed = Object.values(VendorType) as string[]
      if (typeof submitted !== "string" || !allowed.includes(submitted)) {
        return res.status(400).json({
          type: "invalid_data",
          message: `vendor_type must be one of: ${allowed.join(", ")}`,
          allowed_vendor_types: allowed,
        })
      }
    }

    if ("enabled_extensions" in metadataUpdate) {
      const { data: existingMeta } = await query.graph({
        entity: "seller_metadata",
        fields: ["enabled_extensions"],
        filters: { seller_id: sellerId },
      })
      const heldRaw = (
        existingMeta?.[0] as { enabled_extensions?: unknown } | undefined
      )?.enabled_extensions

      const unknownKeys = await findUnknownExtensionKeys(
        metadataUpdate.enabled_extensions,
        {
          previouslyHeld: Array.isArray(heldRaw) ? (heldRaw as string[]) : [],
          resolvePluginSlug: async (slug) => {
            const registry = req.scope.resolve<PluginRegistryService>(
              PLUGIN_REGISTRY_MODULE
            )
            return Boolean(await registry.getBySlug(slug))
          },
        }
      )

      if (unknownKeys.length) {
        return res.status(400).json({
          type: "invalid_data",
          message:
            `Unknown extension key(s): ${unknownKeys.join(", ")}. ` +
            `Expected a dashboard feature key or an installable plugin slug.`,
          unknown_keys: unknownKeys,
          allowed_feature_keys: UI_FEATURE_KEYS,
        })
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
        await updateSellerMetadataRecord(sellerExtensionModule as SellerExtensionService, [
          { id: metadataId, ...metadataUpdate },
        ])
      } else {
        // Create new metadata record
        await createSellerMetadataRecord(sellerExtensionModule as SellerExtensionService, [
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
