import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleSellerRegistration } from "../../shared/seller-registration"

// Opts out of nothing that runs here: Mercur's `/vendor/*` guard is a
// middleware entry, which this flag does not reach.
export const AUTHENTICATE = false

/**
 * POST /vendor/register
 *
 * Files a seller application for the caller's own login, like
 * `POST /auth/seller/register-request` (which the vendor panel uses).
 *
 * What reaches it: Mercur's `/vendor/*` guard runs first and answers 401 to a
 * caller with no seller token and 403 "Seller is not active" to a token with
 * no actor yet, so only a seller's token gets through. `ensureSellerContext`
 * (`../_middlewares.ts`) then calls the handler directly, before the
 * method-scoped entries in `middlewares.ts` run. The handler files for the
 * token's login and refuses a body email that is not that login's (SD-127).
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  return handleSellerRegistration(req, res)
}
