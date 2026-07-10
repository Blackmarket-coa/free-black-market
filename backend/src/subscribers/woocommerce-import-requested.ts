import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createLogger } from "../shared/logger"
import { WOOCOMMERCE_IMPORT_MODULE } from "../modules/woocommerce-import"
import WooCommerceImportModuleService from "../modules/woocommerce-import/service"
import { importWooProductsWorkflow } from "../workflows/woocommerce-import/import-woo-products"
import { decrypt } from "../modules/woocommerce-import/lib/encryption"
import { ImportStatus } from "../modules/woocommerce-import/types"

const log = createLogger("subscribers/woocommerce-import-requested")

type WooImportRequestedPayload = {
  seller_id: string
  connection_id: string
  import_log_id: string
  import_as_draft: boolean
}

/**
 * Subscriber: runs a WooCommerce product import in the background.
 *
 * The POST /vendor/woocommerce/import route creates the import log, emits
 * "woocommerce.import.requested", and returns 202 immediately — so a store with
 * thousands of products can't blow the HTTP timeout. This handler decrypts the
 * connection and runs the import workflow; on failure the workflow's own
 * compensation flips the log to FAILED, and we do so defensively here too.
 */
export default async function wooImportRequestedHandler({
  event,
  container,
}: SubscriberArgs<WooImportRequestedPayload>) {
  const { seller_id, connection_id, import_log_id, import_as_draft } = event.data

  const woo = container.resolve(
    WOOCOMMERCE_IMPORT_MODULE
  ) as WooCommerceImportModuleService

  try {
    const conn = await woo.retrieveWooCommerceConnection(connection_id)
    if (!conn) {
      throw new Error(`WooCommerce connection ${connection_id} not found`)
    }

    const credentials = {
      url: decrypt(conn.store_url),
      consumer_key: decrypt(conn.consumer_key),
      consumer_secret: decrypt(conn.consumer_secret),
    }

    await importWooProductsWorkflow(container).run({
      input: {
        credentials,
        seller_id,
        currency: (conn.currency || "USD").toLowerCase(),
        import_as_draft,
        import_log_id,
      },
    })

    log.info(`Completed background Woo import for seller ${seller_id}`)
  } catch (error: any) {
    log.error(
      `Background Woo import failed for seller ${seller_id}: ${error?.message}`
    )
    // Defensive: ensure the log never stays IN_PROGRESS/PENDING (which would
    // block all future imports for this connection).
    try {
      await woo.updateWooCommerceImportLogs({
        id: import_log_id,
        status: ImportStatus.FAILED,
        completed_at: new Date(),
      })
    } catch {
      // best effort
    }
  }
}

export const config: SubscriberConfig = {
  event: "woocommerce.import.requested",
}
