import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { handleSellerRegistration } from "../../shared/seller-registration"

// Opts out of nothing that runs here: Mercur's authenticate on this path is a
// middleware entry, which this flag does not reach.
export const AUTHENTICATE = false

/**
 * POST /vendor/sellers
 *
 * Overrides @mercurjs/b2c-core's route of the same path (Medusa keeps the last
 * route registered, and the project's are loaded after plugins). Mercur
 * authenticates it with `allowUnregistered`, so any seller token reaches here,
 * including the registration token anyone can get by registering a throwaway
 * address. Its body must also pass Mercur's strict `VendorCreateSeller`, which
 * is why the vendor panel files through `POST /auth/seller/register-request`.
 *
 * This route used to find the login by the body's member email, like the
 * other two (SD-127), and skipped the verification mail. It now files the same
 * way they do: for the caller's own login, with that login's address.
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  return handleSellerRegistration(req, res)
}
