import {
  createStep,
  StepResponse,
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SELLER_EXTENSION_MODULE } from "../modules/seller-extension"
import SellerExtensionService from "../modules/seller-extension/service"
import { VendorType } from "../modules/seller-extension/models/seller-metadata"
import {
  createSellerMetadataRecord,
  deleteSellerMetadataRecord,
} from "../modules/seller-extension/metadata-service"

type CreateSellerMetadataInput = {
  seller_id: string
  vendor_type?: VendorType
  business_registration_number?: string
  tax_classification?: string
  website_url?: string | null
  social_links?: Record<string, any> | null
  storefront_links?: Record<string, any> | null
  farm_practices?: Record<string, any>
  certifications?: Record<string, any>[]
  growing_region?: string
  cuisine_types?: string[]
  service_types?: string[]
  featured?: boolean
  verified?: boolean
  /** Feature-key override (union of multi-role default features). */
  enabled_extensions?: string[] | null
  metadata?: Record<string, any>
}

/**
 * Step: Create Seller Metadata
 * 
 * Creates the seller_metadata record for a seller.
 */
const createSellerMetadataStep = createStep(
  "create-seller-metadata-step",
  async (input: CreateSellerMetadataInput, { container }) => {
    const sellerExtensionService: SellerExtensionService = container.resolve(
      SELLER_EXTENSION_MODULE
    )

    const sellerMetadata = await createSellerMetadataRecord(sellerExtensionService, {
      seller_id: input.seller_id,
      vendor_type: input.vendor_type || VendorType.GENERAL,
      business_registration_number: input.business_registration_number || null,
      tax_classification: input.tax_classification || null,
      website_url: input.website_url || null,
      social_links: input.social_links || null,
      storefront_links: input.storefront_links || null,
      farm_practices: input.farm_practices || null,
      certifications: input.certifications || null,
      growing_region: input.growing_region || null,
      cuisine_types: input.cuisine_types || null,
      service_types: input.service_types || null,
      featured: input.featured ?? false,
      verified: input.verified ?? false,
      enabled_extensions: input.enabled_extensions ?? null,
      metadata: input.metadata || null,
    } as any)

    return new StepResponse(sellerMetadata, sellerMetadata.id)
  },
  async (sellerMetadataId, { container }) => {
    // Compensation: delete the seller metadata if workflow fails
    if (!sellerMetadataId) {
      return
    }

    const sellerExtensionService: SellerExtensionService = container.resolve(
      SELLER_EXTENSION_MODULE
    )

    await deleteSellerMetadataRecord(sellerExtensionService, sellerMetadataId)
  }
)

/**
 * Workflow: Create Seller Metadata
 * 
 * Creates seller metadata (including vendor_type) for a seller.
 * This should be called after the main seller is created.
 */
export const createSellerMetadataWorkflow = createWorkflow(
  "create-seller-metadata",
  (input: CreateSellerMetadataInput) => {
    const sellerMetadata = createSellerMetadataStep(input)
    
    return new WorkflowResponse({
      seller_metadata: sellerMetadata,
    })
  }
)

export default createSellerMetadataWorkflow
