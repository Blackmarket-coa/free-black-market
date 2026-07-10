import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ODOO_IMPORT_MODULE } from "../../../modules/odoo-import"
import OdooImportModuleService from "../../../modules/odoo-import/service"
import { encrypt } from "../../../modules/woocommerce-import/lib/encryption"

export type SaveOdooConnectionInput = {
  seller_id: string
  credentials: {
    url: string
    db_name: string
    username: string
    api_key: string
  }
  store_name: string
  currency: string
}

/** Encrypt + upsert the vendor's Odoo connection (one per seller). */
const saveOdooConnectionStep = createStep(
  "save-odoo-connection-step",
  async (input: SaveOdooConnectionInput, { container }) => {
    const svc: OdooImportModuleService = container.resolve(ODOO_IMPORT_MODULE)

    const data = {
      url: encrypt(input.credentials.url),
      db_name: encrypt(input.credentials.db_name),
      username: encrypt(input.credentials.username),
      api_key: encrypt(input.credentials.api_key),
      store_name: input.store_name,
      currency: input.currency,
    }

    const existing = await svc.listOdooConnections({ seller_id: input.seller_id })
    let connection
    if (existing.length > 0) {
      connection = await svc.updateOdooConnections({ id: existing[0].id, ...data })
    } else {
      connection = await svc.createOdooConnections({
        seller_id: input.seller_id,
        ...data,
      })
    }

    return new StepResponse({ connection })
  }
)

export default saveOdooConnectionStep
