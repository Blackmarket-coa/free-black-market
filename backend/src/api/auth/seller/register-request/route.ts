import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleSellerRegistration } from "../../../shared/seller-registration"

// Medusa applies no default authenticate under /auth, so this changes nothing;
// the handler verifies the caller's seller token itself.
export const AUTHENTICATE = false

/**
 * POST /auth/seller/register-request
 *
 * The vendor panel's sign-up files the seller application here, with the
 * token `POST /auth/seller/emailpass/register` (or, for an existing login,
 * `POST /auth/seller/emailpass`) returned. The application is for that
 * token's login, and its member email must be that login's address: a caller
 * with no seller token gets 401 and nothing is written (SD-127).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  return handleSellerRegistration(req, res)
}
