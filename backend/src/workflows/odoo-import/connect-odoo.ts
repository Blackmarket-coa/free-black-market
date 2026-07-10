import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import validateOdooConnectionStep from "./steps/validate-odoo-connection"
import saveOdooConnectionStep from "./steps/save-odoo-connection"

type ConnectOdooInput = {
  seller_id: string
  url: string
  db_name: string
  username: string
  api_key: string
}

export const connectOdooWorkflow = createWorkflow(
  "connect-odoo",
  (input: ConnectOdooInput) => {
    const credentials = {
      url: input.url,
      db_name: input.db_name,
      username: input.username,
      api_key: input.api_key,
    }

    const storeInfo = validateOdooConnectionStep({ credentials })

    const { connection } = saveOdooConnectionStep({
      seller_id: input.seller_id,
      credentials,
      store_name: storeInfo.store_name,
      currency: storeInfo.currency,
    })

    return new WorkflowResponse({ connection, store_info: storeInfo })
  }
)

export default connectOdooWorkflow
