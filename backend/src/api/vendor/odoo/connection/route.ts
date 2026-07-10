import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { ODOO_IMPORT_MODULE } from "../../../../modules/odoo-import"
import OdooImportModuleService from "../../../../modules/odoo-import/service"
import { connectOdooWorkflow } from "../../../../workflows/odoo-import/connect-odoo"
import { decrypt } from "../../../../modules/woocommerce-import/lib/encryption"
import { assertPublicHttpUrl, BlockedUrlError } from "../../../../shared/safe-fetch"

/**
 * GET /vendor/odoo/connection — current vendor's Odoo connection status.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  try {
    const svc: OdooImportModuleService = req.scope.resolve(ODOO_IMPORT_MODULE)
    const connections = await svc.listOdooConnections({ seller_id: sellerId })
    if (connections.length === 0) return res.json({ connection: null })

    const conn = connections[0]
    return res.json({
      connection: {
        id: conn.id,
        url: decrypt(conn.url),
        db_name: decrypt(conn.db_name),
        username: decrypt(conn.username),
        store_name: conn.store_name,
        currency: conn.currency,
        last_import_at: conn.last_import_at,
        created_at: conn.created_at,
        updated_at: conn.updated_at,
      },
    })
  } catch (error: any) {
    return res.status(500).json({ message: "Failed to fetch connection", error: error.message })
  }
}

/**
 * POST /vendor/odoo/connection — connect an Odoo instance (validate + save).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const { url, db_name, username, api_key } = req.body as {
    url: string
    db_name: string
    username: string
    api_key: string
  }

  if (!url || !db_name || !username || !api_key) {
    return res.status(400).json({
      message: "url, db_name, username, and api_key are required",
    })
  }

  // SSRF hardening: this URL is fetched server-side by the Odoo JSON-RPC client.
  try {
    await assertPublicHttpUrl(url)
  } catch (err) {
    return res.status(400).json({
      message: err instanceof BlockedUrlError ? err.message : "Invalid Odoo URL",
    })
  }

  try {
    const { result } = await connectOdooWorkflow(req.scope).run({
      input: { seller_id: sellerId, url: url.replace(/\/+$/, ""), db_name, username, api_key },
    })

    return res.status(201).json({
      connection: {
        url,
        store_name: result.store_info.store_name,
        currency: result.store_info.currency,
      },
      message: "Odoo store connected successfully",
    })
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to connect Odoo store",
    })
  }
}

/**
 * DELETE /vendor/odoo/connection — remove the vendor's Odoo connection.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  try {
    const svc: OdooImportModuleService = req.scope.resolve(ODOO_IMPORT_MODULE)
    const connections = await svc.listOdooConnections({ seller_id: sellerId })
    if (connections.length === 0) {
      return res.status(404).json({ message: "No Odoo connection found" })
    }
    await svc.deleteOdooConnections(connections[0].id)
    return res.json({ id: connections[0].id, deleted: true, message: "Odoo connection removed" })
  } catch (error: any) {
    return res.status(500).json({ message: "Failed to remove connection", error: error.message })
  }
}
