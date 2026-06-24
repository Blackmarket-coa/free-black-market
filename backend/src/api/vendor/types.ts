import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http"

/**
 * Vendor API request shape: the authenticated Medusa request plus the
 * per-request fields the vendor `_middlewares` seller-context guard attaches.
 */
export type VendorRequest = AuthenticatedMedusaRequest & {
  _seller_id?: string
  _sellerContextResolved?: boolean
}
