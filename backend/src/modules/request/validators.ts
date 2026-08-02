import { z } from "zod"
import { VendorType } from "../seller-extension/models/seller-metadata"

/**
 * Request Type Identifiers
 *
 * IMPORTANT: When adding new request types:
 * 1. Add the type constant here
 * 2. Create a corresponding payload schema below
 * 3. Add it to the discriminated union (requestPayloadSchema)
 * 4. Export the type inference
 */
export const REQUEST_TYPES = {
  // Seller registration request (used by vendor registration)
  SELLER: "seller",
  SELLER_CREATION: "seller_creation", // Alias for backwards compatibility
  // Future request types
  CUSTOM_ORDER: "custom_order",
  QUOTE_REQUEST: "quote_request",
  PRODUCT_CHANGE: "product_change",
  REVIEW_REMOVAL: "review_removal",
  RETURN_REQUEST: "return_request",
} as const

export type RequestType = typeof REQUEST_TYPES[keyof typeof REQUEST_TYPES]

/**
 * Vendor types available for sellers.
 *
 * Derived from the `VendorType` enum rather than restated — the hand-written
 * copy this replaces had drifted out of sync (missing `creator`).
 */
const vendorTypeEnum = z.enum(
  Object.values(VendorType) as [string, ...string[]]
)

/**
 * Base Seller Request Payload Schema
 * Used for seller registration requests (type: "seller")
 */
export const sellerRequestPayloadSchema = z.object({
  type: z.literal(REQUEST_TYPES.SELLER),
  auth_identity_id: z.string().min(1, "Auth identity ID is required"),
  member: z.object({
    name: z.string().min(1, "Member name is required"),
    email: z.string().email("Valid email is required"),
  }),
  seller: z.object({
    name: z.string().min(1, "Seller name is required"),
  }),
  vendor_type: vendorTypeEnum.default(VendorType.GENERAL),
})

/**
 * Seller Creation Request Payload Schema (alias)
 * Backwards compatible alias for "seller_creation" type
 */
export const sellerCreationPayloadSchema = z.object({
  type: z.literal(REQUEST_TYPES.SELLER_CREATION),
  auth_identity_id: z.string().min(1, "Auth identity ID is required"),
  member: z.object({
    name: z.string().min(1, "Member name is required"),
    email: z.string().email("Valid email is required"),
  }),
  seller: z.object({
    name: z.string().min(1, "Seller name is required"),
  }),
  vendor_type: vendorTypeEnum.default(VendorType.GENERAL),
})

/**
 * Custom Order Request Payload Schema (for future use)
 */
export const customOrderPayloadSchema = z.object({
  type: z.literal(REQUEST_TYPES.CUSTOM_ORDER),
  products: z.array(z.object({
    product_id: z.string().optional(),
    name: z.string(),
    quantity: z.number().positive(),
    notes: z.string().optional(),
  })),
  delivery_date: z.string().optional(),
  delivery_address: z.object({
    address_1: z.string(),
    city: z.string(),
    postal_code: z.string(),
    country_code: z.string(),
  }).optional(),
})

/**
 * Quote Request Payload Schema (for future use)
 */
export const quoteRequestPayloadSchema = z.object({
  type: z.literal(REQUEST_TYPES.QUOTE_REQUEST),
  description: z.string().min(1, "Description is required"),
  quantity: z.number().positive().optional(),
  budget: z.number().positive().optional(),
  deadline: z.string().optional(),
})

/**
 * Union of all request payload schemas
 * Uses discriminated union for type-safe validation based on "type" field
 */
export const requestPayloadSchema = z.discriminatedUnion("type", [
  sellerRequestPayloadSchema,
  sellerCreationPayloadSchema,
  customOrderPayloadSchema,
  quoteRequestPayloadSchema,
])

/**
 * Type exports for use in application code
 */
export type SellerRequestPayload = z.infer<typeof sellerRequestPayloadSchema>
export type SellerCreationPayload = z.infer<typeof sellerCreationPayloadSchema>
export type CustomOrderPayload = z.infer<typeof customOrderPayloadSchema>
export type QuoteRequestPayload = z.infer<typeof quoteRequestPayloadSchema>
export type RequestPayload = z.infer<typeof requestPayloadSchema>

/**
 * Validate request payload based on type
 * @param payload - The payload to validate
 * @returns Validated payload
 * @throws ZodError if validation fails
 */
export function validateRequestPayload(payload: unknown): RequestPayload {
  return requestPayloadSchema.parse(payload)
}

/**
 * Safe validation that returns success/error result
 * Use this when you want to handle errors gracefully
 */
export function safeValidateRequestPayload(payload: unknown) {
  return requestPayloadSchema.safeParse(payload)
}

/**
 * Validate a seller request payload specifically
 * Accepts both "seller" and "seller_creation" types
 */
export function validateSellerRequestPayload(payload: unknown): SellerRequestPayload | SellerCreationPayload {
  // Try "seller" type first
  const sellerResult = sellerRequestPayloadSchema.safeParse(payload)
  if (sellerResult.success) {
    return sellerResult.data
  }

  // Fallback to "seller_creation" type
  const creationResult = sellerCreationPayloadSchema.safeParse(payload)
  if (creationResult.success) {
    return creationResult.data
  }

  // If both fail, throw the first error
  throw sellerResult.error
}

/**
 * Check if a request type is a seller registration type
 */
export function isSellerRequestType(type: string): boolean {
  return type === REQUEST_TYPES.SELLER || type === REQUEST_TYPES.SELLER_CREATION
}

/**
 * Get human-readable name for a request type
 */
export function getRequestTypeName(type: string): string {
  const names: Record<string, string> = {
    [REQUEST_TYPES.SELLER]: "Seller Registration",
    [REQUEST_TYPES.SELLER_CREATION]: "Seller Registration",
    [REQUEST_TYPES.CUSTOM_ORDER]: "Custom Order",
    [REQUEST_TYPES.QUOTE_REQUEST]: "Quote Request",
    [REQUEST_TYPES.PRODUCT_CHANGE]: "Product Change",
    [REQUEST_TYPES.REVIEW_REMOVAL]: "Review Removal",
    [REQUEST_TYPES.RETURN_REQUEST]: "Return Request",
  }
  return names[type] || type
}
