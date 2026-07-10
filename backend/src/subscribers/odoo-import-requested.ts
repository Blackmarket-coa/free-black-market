import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createLogger } from "../shared/logger"
import { ODOO_IMPORT_MODULE } from "../modules/odoo-import"
import OdooImportModuleService from "../modules/odoo-import/service"
import { importOdooProductsWorkflow } from "../workflows/odoo-import/import-odoo-products"
import { decrypt } from "../modules/woocommerce-import/lib/encryption"
import { OdooImportStatus } from "../modules/odoo-import/types"

const log = createLogger("subscribers/odoo-import-requested")

type OdooImportRequestedPayload = {
  seller_id: string
  connection_id: string
  import_log_id: string
  import_as_draft: boolean
}

/**
 * Subscriber: runs an Odoo product import in the background (mirrors the
 * WooCommerce importer). The route creates the log + emits the event + returns
 * 202; this decrypts the connection and runs the workflow.
 */
export default async function odooImportRequestedHandler({
  event,
  container,
}: SubscriberArgs<OdooImportRequestedPayload>) {
  const { seller_id, connection_id, import_log_id, import_as_draft } = event.data

  const svc = container.resolve(ODOO_IMPORT_MODULE) as OdooImportModuleService

  try {
    const conn = await svc.retrieveOdooConnection(connection_id)
    if (!conn) throw new Error(`Odoo connection ${connection_id} not found`)

    const credentials = {
      url: decrypt(conn.url),
      db_name: decrypt(conn.db_name),
      username: decrypt(conn.username),
      api_key: decrypt(conn.api_key),
    }

    await importOdooProductsWorkflow(container).run({
      input: {
        credentials,
        seller_id,
        currency: (conn.currency || "USD").toLowerCase(),
        import_as_draft,
        import_log_id,
      },
    })

    await svc.updateOdooConnections({ id: connection_id, last_import_at: new Date() })
    log.info(`Completed background Odoo import for seller ${seller_id}`)
  } catch (error: any) {
    log.error(`Background Odoo import failed for seller ${seller_id}: ${error?.message}`)
    try {
      await svc.updateOdooImportLogs({
        id: import_log_id,
        status: OdooImportStatus.FAILED,
        completed_at: new Date(),
      })
    } catch {
      // best effort
    }
  }
}

export const config: SubscriberConfig = {
  event: "odoo.import.requested",
}
