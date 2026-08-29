import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { servePublishingKeys } from "../../middlewares/publishing-keys"

/**
 * Non-dotted mount of the publishing keyset. The canonical public path is
 * /.well-known/freeblackmarket-publishing-keys.json, served via the
 * middlewares.ts alias — see src/api/middlewares/publishing-keys.ts for why a
 * dotted route directory cannot exist here.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return servePublishingKeys(req, res)
}
