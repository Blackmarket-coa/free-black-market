import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import type { VendorRequest } from "../../types"
import { WOOCOMMERCE_IMPORT_MODULE } from "../../../../modules/woocommerce-import"
import WooCommerceImportModuleService from "../../../../modules/woocommerce-import/service"
import { ImportStatus } from "../../../../modules/woocommerce-import/types"

/** Event that triggers the background Woo import (handled by a subscriber). */
export const WOO_IMPORT_REQUESTED_EVENT = "woocommerce.import.requested"

/**
 * POST /vendor/woocommerce/import
 * Kick off a background import from the connected WooCommerce store.
 *
 * The import runs asynchronously (event → subscriber → workflow) so large stores
 * don't exceed the request timeout. Returns 202 with an import_log_id the panel
 * polls via GET /vendor/woocommerce/import.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const { import_as_draft = true, enable_inventory_sync = true } = req.body as {
    import_as_draft?: boolean
    enable_inventory_sync?: boolean
  }

  const wooService: WooCommerceImportModuleService = req.scope.resolve(
    WOOCOMMERCE_IMPORT_MODULE
  )

  // Declared before the try so the catch can mark the log FAILED (defence in
  // depth alongside the workflow's own compensation) rather than leaving it
  // stuck IN_PROGRESS and permanently blocking future imports.
  let importLogId: string | undefined

  try {
    // Get the connection
    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    })

    if (connections.length === 0) {
      return res.status(404).json({
        message: "No WooCommerce connection found. Connect your store first.",
      })
    }

    const conn = connections[0]

    // Fast-path check for in-progress imports (1 import at a time). The
    // authoritative guard is the partial unique index enforced on create below.
    const activeImports = await wooService.listWooCommerceImportLogs({
      connection_id: conn.id,
      status: [ImportStatus.PENDING, ImportStatus.IN_PROGRESS],
    })

    if (activeImports.length > 0) {
      return res.status(429).json({
        message: "An import is already in progress. Please wait for it to complete.",
        import_log_id: activeImports[0].id,
      })
    }

    // Update inventory sync preference
    if (conn.sync_inventory !== enable_inventory_sync) {
      await wooService.updateWooCommerceConnections({
        id: conn.id,
        sync_inventory: enable_inventory_sync,
      })
    }

    // Create an import log entry. A concurrent import that slipped past the
    // fast-path check will violate the partial unique index here → 429.
    let importLog
    try {
      importLog = await wooService.createWooCommerceImportLogs({
        connection_id: conn.id,
        status: ImportStatus.PENDING,
        import_as_draft,
      })
    } catch (createError) {
      if (isUniqueViolation(createError)) {
        return res.status(429).json({
          message:
            "An import is already in progress. Please wait for it to complete.",
        })
      }
      throw createError
    }
    importLogId = importLog.id

    // Hand off to the background worker. Credentials are NOT put on the event —
    // the subscriber re-reads and decrypts the connection so secrets never sit
    // in the event payload/log.
    const eventBus = req.scope.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
    await eventBus.emit({
      name: WOO_IMPORT_REQUESTED_EVENT,
      data: {
        seller_id: sellerId,
        connection_id: conn.id,
        import_log_id: importLog.id,
        import_as_draft,
      },
    })

    return res.status(202).json({
      import_log_id: importLog.id,
      status: "started",
      message: "Import started. This runs in the background — track progress below.",
    })
  } catch (error) {
    // If we created a log but couldn't hand it off, don't leave it stuck.
    if (importLogId) {
      try {
        await wooService.updateWooCommerceImportLogs({
          id: importLogId,
          status: ImportStatus.FAILED,
          completed_at: new Date(),
        })
      } catch {
        // Best-effort; do not mask the original error.
      }
    }
    return res.status(500).json({
      message: "Import failed",
      error: error.message,
    })
  }
}

type DbError = {
  code?: string
  message?: string
  cause?: { code?: string; message?: string }
}

/** Detect a Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(error: unknown): boolean {
  const e = (error ?? {}) as DbError
  const code = e.code || e.cause?.code
  const text = `${e.message || ""} ${e.cause?.message || ""}`
  return (
    code === "23505" ||
    /duplicate key value|unique constraint|UQ_woo_import_log_active_per_connection/i.test(
      text
    )
  )
}

/**
 * GET /vendor/woocommerce/import
 * Get import history for the current vendor.
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

    // Get the connection
    const connections = await wooService.listWooCommerceConnections({
      seller_id: sellerId,
    })

    if (connections.length === 0) {
      return res.json({ imports: [] })
    }

    const importLogs = await wooService.listWooCommerceImportLogs(
      { connection_id: connections[0].id },
      { order: { created_at: "DESC" } }
    )

    return res.json({
      imports: importLogs.map((log) => ({
        id: log.id,
        status: log.status,
        total_products: log.total_products,
        imported_count: log.imported_count,
        failed_count: log.failed_count,
        skipped_count: log.skipped_count,
        import_as_draft: log.import_as_draft,
        error_details: log.error_details,
        started_at: log.started_at,
        completed_at: log.completed_at,
        created_at: log.created_at,
      })),
    })
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch import history",
      error: error.message,
    })
  }
}
