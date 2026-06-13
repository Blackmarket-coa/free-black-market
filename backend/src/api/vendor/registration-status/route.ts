import { createLogger } from "../../../shared/logger"
const log = createLogger("api/vendor/registration-status")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// Allow this endpoint to be accessed without seller authentication
export const AUTHENTICATE = false

/**
 * GET /vendor/registration-status
 *
 * DEPRECATED: This endpoint has been moved to /auth/seller/registration-status
 * to avoid MercurJS b2c-core plugin vendor authentication middleware that
 * blocks pending users who don't have a seller_id yet.
 *
 * This endpoint now redirects to the new location.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  log.info("[GET /vendor/registration-status] DEPRECATED - redirecting to /auth/seller/registration-status")

  // Get the base URL from the request
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const baseUrl = `${protocol}://${host}`

  // Redirect to the new endpoint
  return res.redirect(307, `${baseUrl}/auth/seller/registration-status`)
}
