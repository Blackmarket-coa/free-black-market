import { createLogger } from "./logger"
const log = createLogger("shared/seller-profile")
import { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const DEFAULT_METADATA_FIELDS = [
  "vendor_type",
  "website_url",
  "social_links",
  "storefront_links",
  "certifications",
  "enabled_extensions",
]

const METADATA_FIELD_SET = new Set(DEFAULT_METADATA_FIELDS)

export const DEFAULT_SELLER_FIELDS = [
  "id",
  "name",
  "description",
  "phone",
  "email",
  "handle",
  "photo",
  "address_line",
  "postal_code",
  "city",
  "country_code",
  "tax_id",
  "store_status",
  "metadata",
  "created_at",
  "updated_at",
]

const normalizeRequestedFields = (
  requestedFields: unknown
): string | string[] | undefined => {
  if (typeof requestedFields === "string") {
    return requestedFields
  }

  if (Array.isArray(requestedFields) && requestedFields.every(item => typeof item === "string")) {
    return requestedFields
  }

  return undefined
}

const parseRequestedFields = (
  requestedFields: unknown,
  defaultSellerFields: string[]
) => {
  const normalizedFields = normalizeRequestedFields(requestedFields)
  const requested =
    typeof normalizedFields === "string" ? normalizedFields : normalizedFields?.join(",")

  if (!requested) {
    return {
      sellerFields: [...defaultSellerFields],
      metadataFields: [...DEFAULT_METADATA_FIELDS],
      includeMediaAlias: true,
    }
  }

  const parsedFields = requested.split(",").map(field => field.trim()).filter(Boolean)
  const metadataFields = parsedFields.filter(field => METADATA_FIELD_SET.has(field))
  const sellerFields = parsedFields
    .filter(field => !METADATA_FIELD_SET.has(field))
    .map(field => (field === "media" ? "photo" : field))

  const uniqueSellerFields = Array.from(new Set(sellerFields))
  const uniqueMetadataFields = Array.from(new Set(metadataFields))

  if (!uniqueSellerFields.includes("id")) {
    uniqueSellerFields.unshift("id")
  }

  return {
    sellerFields: uniqueSellerFields,
    metadataFields: uniqueMetadataFields,
    includeMediaAlias: parsedFields.includes("media"),
  }
}

export const fetchSellerProfile = async ({
  req,
  sellerId,
  requestedFields,
  defaultSellerFields = DEFAULT_SELLER_FIELDS,
}: {
  req: MedusaRequest
  sellerId: string
  requestedFields?: unknown
  defaultSellerFields?: string[]
}): Promise<Record<string, unknown> | null> => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { sellerFields, metadataFields, includeMediaAlias } = parseRequestedFields(
    requestedFields,
    defaultSellerFields
  )

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: sellerFields,
    filters: { id: sellerId },
  })

  if (!sellers || sellers.length === 0) {
    return null
  }

  const seller = sellers[0] as Record<string, unknown>
  const response: Record<string, unknown> = {
    ...seller,
  }

  if (metadataFields.length > 0) {
    try {
      const { data: metadataRecords } = await query.graph({
        entity: "seller_metadata",
        fields: metadataFields,
        filters: { seller_id: sellerId },
      })
      const sellerMetadata = (metadataRecords?.[0] ?? {}) as Record<string, unknown>
      for (const field of metadataFields) {
        response[field] = sellerMetadata[field]
      }
    } catch (error) {
      log.warn("[fetchSellerProfile] Failed to load seller metadata:", error)
    }
  }

  if (includeMediaAlias) {
    response.media = seller.photo
  }

  return response
}
