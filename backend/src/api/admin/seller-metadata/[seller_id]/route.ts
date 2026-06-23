import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/seller-metadata/[seller_id]")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { IEventBusModuleService } from "@medusajs/framework/types"
import { SELLER_EXTENSION_MODULE } from "../../../../modules/seller-extension"
import SellerExtensionService from "../../../../modules/seller-extension/service"
import { VendorType } from "../../../../modules/seller-extension/models/seller-metadata"
import {
  deleteSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../../modules/seller-extension/metadata-service"

/**
 * GET /admin/seller-metadata/:seller_id
 * 
 * Get seller metadata by seller ID.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { seller_id } = req.params
  
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: sellerMetadata } = await query.graph({
    entity: "seller_metadata",
    fields: ["*"],
    filters: {
      seller_id,
    },
  })

  if (!sellerMetadata || sellerMetadata.length === 0) {
    return res.status(404).json({
      message: `Seller metadata for seller ${seller_id} not found`,
    })
  }

  return res.json({
    seller_metadata: sellerMetadata[0],
  })
}

/**
 * PUT /admin/seller-metadata/:seller_id
 * 
 * Update seller metadata by seller ID.
 * Emits "vendor.verified" event when verified is set to true.
 */
export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { seller_id } = req.params
  
  const sellerExtensionService: SellerExtensionService = req.scope.resolve(
    SELLER_EXTENSION_MODULE
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const eventBus: IEventBusModuleService = req.scope.resolve(Modules.EVENT_BUS)

  // First, find the existing metadata including current verified status
  const { data: existingMetadata } = await query.graph({
    entity: "seller_metadata",
    fields: ["id", "verified"],
    filters: {
      seller_id,
    },
  })

  if (!existingMetadata || existingMetadata.length === 0) {
    return res.status(404).json({
      message: `Seller metadata for seller ${seller_id} not found`,
    })
  }

  const wasVerified = existingMetadata[0].verified

  const body = req.body as unknown as {
    vendor_type?: VendorType
    business_registration_number?: string
    tax_classification?: string
    farm_practices?: Record<string, unknown>
    certifications?: Record<string, unknown>[]
    growing_region?: string
    cuisine_types?: string[]
    service_types?: string[]
    featured?: boolean
    verified?: boolean
    enabled_extensions?: string[] | null
    metadata?: Record<string, unknown>
  }

  const updateData: Record<string, unknown> = {
    id: existingMetadata[0].id,
    ...body,
  }
  
  // Convert arrays to JSON for storage
  if (body.certifications) {
    updateData.certifications = JSON.stringify(body.certifications)
  }
  if (body.cuisine_types) {
    updateData.cuisine_types = JSON.stringify(body.cuisine_types)
  }
  if (body.service_types) {
    updateData.service_types = JSON.stringify(body.service_types)
  }
  
  const updated = await updateSellerMetadataRecord(sellerExtensionService, updateData)

  // Emit vendor.verified event if verified changed from false to true
  if (!wasVerified && body.verified === true) {
    await eventBus.emit({
      name: "vendor.verified",
      data: {
        seller_id,
      },
    })
    log.info(`Emitted vendor.verified event for seller ${seller_id}`)
  }

  return res.json({
    seller_metadata: updated,
  })
}

/**
 * DELETE /admin/seller-metadata/:seller_id
 * 
 * Delete seller metadata by seller ID.
 */
export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { seller_id } = req.params
  
  const sellerExtensionService: SellerExtensionService = req.scope.resolve(
    SELLER_EXTENSION_MODULE
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // First, find the existing metadata
  const { data: existingMetadata } = await query.graph({
    entity: "seller_metadata",
    fields: ["id"],
    filters: {
      seller_id,
    },
  })

  if (!existingMetadata || existingMetadata.length === 0) {
    return res.status(404).json({
      message: `Seller metadata for seller ${seller_id} not found`,
    })
  }

  await deleteSellerMetadataRecord(sellerExtensionService, existingMetadata[0].id)

  return res.status(200).json({
    id: existingMetadata[0].id,
    object: "seller_metadata",
    deleted: true,
  })
}
