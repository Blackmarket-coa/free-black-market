import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { WOOCOMMERCE_IMPORT_MODULE } from "../../../../modules/woocommerce-import"
import WooCommerceImportModuleService from "../../../../modules/woocommerce-import/service"
import { connectWooCommerceWorkflow } from "../../../../workflows/woocommerce-import/connect-woocommerce"
import { decrypt } from "../../../../modules/woocommerce-import/lib/encryption"
import { assertPublicHttpUrl, BlockedUrlError } from "../../../../shared/safe-fetch"

/**
 * GET /vendor/woocommerce/connection
 * Get the current vendor's WooCommerce connection status.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const wooService: WooCommerceImportModuleService = req.scope.resolve(
      WOOCOMMERCE_IMPORT_MODULE
    )

    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    })

    if (connections.length === 0) {
      return res.json({ connection: null })
    }

    const conn = connections[0]

    // Return connection info without exposing credentials
    return res.json({
      connection: {
        id: conn.id,
        store_url: decrypt(conn.store_url),
        store_name: conn.store_name,
        currency: conn.currency,
        sync_inventory: conn.sync_inventory,
        last_synced_at: conn.last_synced_at,
        last_sync_report: conn.last_sync_report,
        created_at: conn.created_at,
        updated_at: conn.updated_at,
      },
    })
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch connection",
      error: error.message,
    })
  }
}

/**
 * POST /vendor/woocommerce/connection
 * Connect a WooCommerce store (validate + save credentials).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const { store_url, consumer_key, consumer_secret } = req.body as {
    store_url: string
    consumer_key: string
    consumer_secret: string
  }

  if (!store_url || !consumer_key || !consumer_secret) {
    return res.status(400).json({
      message: "store_url, consumer_key, and consumer_secret are required",
    })
  }

  // Validate the store URL: require https and reject hosts that resolve to
  // private/loopback/link-local addresses (SSRF hardening — this URL is fetched
  // server-side by the WooCommerce client).
  try {
    await assertPublicHttpUrl(store_url)
  } catch (err) {
    return res.status(400).json({
      message:
        err instanceof BlockedUrlError
          ? err.message
          : "Invalid store URL format",
    })
  }

  try {
    const { result } = await connectWooCommerceWorkflow(req.scope).run({
      input: {
        seller_id: sellerId,
        store_url: store_url.replace(/\/+$/, ""),
        consumer_key,
        consumer_secret,
      },
    })

    return res.status(201).json({
      connection: {
        store_url,
        store_name: result.store_info.store_name,
        currency: result.store_info.currency,
        wc_version: result.store_info.wc_version,
      },
      message: "WooCommerce store connected successfully",
    })
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Failed to connect WooCommerce store",
    })
  }
}

/**
 * DELETE /vendor/woocommerce/connection
 * Remove the WooCommerce connection for the current vendor.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const wooService: WooCommerceImportModuleService = req.scope.resolve(
      WOOCOMMERCE_IMPORT_MODULE
    )

    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    })

    if (connections.length === 0) {
      return res.status(404).json({ message: "No WooCommerce connection found" })
    }

    await wooService.deleteWooCommerceConnections(connections[0].id)

    return res.json({
      id: connections[0].id,
      deleted: true,
      message: "WooCommerce connection removed",
    })
  } catch (error) {
    return res.status(500).json({
      message: "Failed to remove connection",
      error: error.message,
    })
  }
}
