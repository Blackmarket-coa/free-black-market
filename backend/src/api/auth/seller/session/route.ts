import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/auth/seller/session")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { fetchSellerProfile } from "../../../../shared/seller-profile"
import { getSellerRegistrationStatus } from "../../../../shared/seller-registration"

export const AUTHENTICATE = false

/**
 * GET /auth/seller/session
 * Returns registration status and seller profile for the authenticated user.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { status, statusCode } = await getSellerRegistrationStatus(req)

    if (statusCode !== 200) {
      return res.status(statusCode).json({
        registration_status: status,
        seller: null,
      })
    }

    if (status.status !== "approved" || !status.seller_id) {
      return res.status(200).json({
        registration_status: status,
        seller: null,
      })
    }

    const seller = await fetchSellerProfile({
      req,
      sellerId: status.seller_id,
      requestedFields: req.query.fields,
    })

    if (!seller) {
      return res.status(404).json({
        registration_status: {
          status: "error",
          seller_id: status.seller_id,
          seller: null,
          store_status: null,
          message: "Seller profile not found for this account. Please contact support.",
        },
        seller: null,
      })
    }

    return res.json({
      registration_status: status,
      seller,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /auth/seller/session] Error:", message)
    return res.status(500).json({
      registration_status: {
        status: "error",
        message: "Failed to load seller session. Please try again later.",
      },
      seller: null,
    })
  }
}
