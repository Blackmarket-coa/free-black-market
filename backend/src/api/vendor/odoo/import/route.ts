import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import type { VendorRequest } from "../../types"
import { ODOO_IMPORT_MODULE } from "../../../../modules/odoo-import"
import OdooImportModuleService from "../../../../modules/odoo-import/service"
import { OdooImportStatus } from "../../../../modules/odoo-import/types"

/** Event that triggers the background Odoo import (handled by a subscriber). */
export const ODOO_IMPORT_REQUESTED_EVENT = "odoo.import.requested"

function isUniqueViolation(error: any): boolean {
  const code = error?.code || error?.cause?.code
  const text = `${error?.message || ""} ${error?.cause?.message || ""}`
  return (
    code === "23505" ||
    /duplicate key value|unique constraint|UQ_odoo_import_log_active_per_connection/i.test(text)
  )
}

/**
 * POST /vendor/odoo/import — start a background import from the connected Odoo
 * store. Returns 202 with an import_log_id the panel polls via GET.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const { import_as_draft = true } = req.body as { import_as_draft?: boolean }

  const svc: OdooImportModuleService = req.scope.resolve(ODOO_IMPORT_MODULE)
  let importLogId: string | undefined

  try {
    const connections = await svc.listOdooConnections({ seller_id: sellerId })
    if (connections.length === 0) {
      return res.status(404).json({ message: "No Odoo connection found. Connect your store first." })
    }
    const conn = connections[0]

    const active = await svc.listOdooImportLogs({
      connection_id: conn.id,
      status: [OdooImportStatus.PENDING, OdooImportStatus.IN_PROGRESS],
    })
    if (active.length > 0) {
      return res.status(429).json({
        message: "An import is already in progress. Please wait for it to complete.",
        import_log_id: active[0].id,
      })
    }

    let importLog
    try {
      importLog = await svc.createOdooImportLogs({
        connection_id: conn.id,
        status: OdooImportStatus.PENDING,
        import_as_draft,
      })
    } catch (createError: any) {
      if (isUniqueViolation(createError)) {
        return res.status(429).json({
          message: "An import is already in progress. Please wait for it to complete.",
        })
      }
      throw createError
    }
    importLogId = importLog.id

    const eventBus = req.scope.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
    await eventBus.emit({
      name: ODOO_IMPORT_REQUESTED_EVENT,
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
  } catch (error: any) {
    if (importLogId) {
      try {
        await svc.updateOdooImportLogs({
          id: importLogId,
          status: OdooImportStatus.FAILED,
          completed_at: new Date(),
        })
      } catch {
        // best effort
      }
    }
    return res.status(500).json({ message: "Import failed", error: error.message })
  }
}

/**
 * GET /vendor/odoo/import — import history for the current vendor.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  try {
    const svc: OdooImportModuleService = req.scope.resolve(ODOO_IMPORT_MODULE)
    const connections = await svc.listOdooConnections({ seller_id: sellerId })
    if (connections.length === 0) return res.json({ imports: [] })

    const logs = await svc.listOdooImportLogs(
      { connection_id: connections[0].id },
      { order: { created_at: "DESC" } }
    )

    return res.json({
      imports: logs.map((logRow: any) => ({
        id: logRow.id,
        status: logRow.status,
        total_products: logRow.total_products,
        imported_count: logRow.imported_count,
        updated_count: logRow.updated_count,
        failed_count: logRow.failed_count,
        skipped_count: logRow.skipped_count,
        import_as_draft: logRow.import_as_draft,
        error_details: logRow.error_details,
        started_at: logRow.started_at,
        completed_at: logRow.completed_at,
        created_at: logRow.created_at,
      })),
    })
  } catch (error: any) {
    return res.status(500).json({ message: "Failed to fetch import history", error: error.message })
  }
}
