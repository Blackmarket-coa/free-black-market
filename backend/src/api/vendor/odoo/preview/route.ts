import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { ODOO_IMPORT_MODULE } from "../../../../modules/odoo-import"
import OdooImportModuleService from "../../../../modules/odoo-import/service"
import { OdooApiClient } from "../../../../modules/odoo-import/lib/odoo-api-client"
import { decrypt } from "../../../../modules/woocommerce-import/lib/encryption"

/**
 * GET /vendor/odoo/preview — how many products the connected Odoo store exposes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  try {
    const svc: OdooImportModuleService = req.scope.resolve(ODOO_IMPORT_MODULE)
    const connections = await svc.listOdooConnections({ seller_id: sellerId })
    if (connections.length === 0) {
      return res.status(404).json({ message: "No Odoo connection found. Connect your store first." })
    }
    const conn = connections[0]
    const client = new OdooApiClient({
      url: decrypt(conn.url),
      db_name: decrypt(conn.db_name),
      username: decrypt(conn.username),
      api_key: decrypt(conn.api_key),
    })

    const total_products = await client.countProducts()

    return res.json({
      preview: {
        total_products,
        store_name: conn.store_name,
        url: decrypt(conn.url),
        currency: conn.currency || "USD",
      },
    })
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to load preview" })
  }
}
