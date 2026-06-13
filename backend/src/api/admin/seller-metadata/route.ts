import { createLogger } from "../../../shared/logger"
const log = createLogger("api/admin/seller-metadata")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SELLER_EXTENSION_MODULE } from "../../../modules/seller-extension"
import SellerExtensionService from "../../../modules/seller-extension/service"
import { VendorType } from "../../../modules/seller-extension/models/seller-metadata"
import { createSellerMetadataRecord } from "../../../modules/seller-extension/metadata-service"

/**
 * GET /admin/seller-metadata
 * 
 * List all seller metadata records with vendor_type info.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const sellerExtensionService: SellerExtensionService = req.scope.resolve(
    SELLER_EXTENSION_MODULE
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get all seller metadata
  const { data: sellerMetadata } = await query.graph({
    entity: "seller_metadata",
    fields: ["*"],
  })

  return res.json({
    seller_metadata: sellerMetadata,
  })
}

/**
 * POST /admin/seller-metadata
 * 
 * Create seller metadata for an existing seller.
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const sellerExtensionService: SellerExtensionService = req.scope.resolve(
    SELLER_EXTENSION_MODULE
  )

  const body = req.body as unknown as {
    seller_id: string
    vendor_type?: VendorType
    business_registration_number?: string
    tax_classification?: string
    farm_practices?: Record<string, any>
    certifications?: Record<string, any>[]
    growing_region?: string
    cuisine_types?: string[]
    service_types?: string[]
    featured?: boolean
    verified?: boolean
    enabled_extensions?: string[] | null
    metadata?: Record<string, any>
  }

  const sellerMetadata = await createSellerMetadataRecord(sellerExtensionService, {
    seller_id: body.seller_id,
    vendor_type: body.vendor_type || VendorType.PRODUCER,
    business_registration_number: body.business_registration_number || null,
    tax_classification: body.tax_classification || null,
    farm_practices: body.farm_practices || null,
    certifications: body.certifications ? JSON.stringify(body.certifications) : null,
    growing_region: body.growing_region || null,
    cuisine_types: body.cuisine_types ? JSON.stringify(body.cuisine_types) : null,
    service_types: body.service_types ? JSON.stringify(body.service_types) : null,
    featured: body.featured ?? false,
    verified: body.verified ?? false,
    enabled_extensions: body.enabled_extensions ?? null,
    metadata: body.metadata || null,
  } as any)

  // Create link between seller and seller_metadata
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  
  try {
    await link.create({
      seller: {
        seller_id: body.seller_id,
      },
      sellerExtension: {
        seller_metadata_id: sellerMetadata.id,
      },
    })
  } catch (error) {
    log.warn("Could not create seller-metadata link:", error)
  }

  return res.status(201).json({
    seller_metadata: sellerMetadata,
  })
}
