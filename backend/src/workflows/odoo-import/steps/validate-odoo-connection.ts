import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { OdooApiClient } from "../../../modules/odoo-import/lib/odoo-api-client"
import type { OdooCredentials } from "../../../modules/odoo-import/types"

export type ValidateOdooInput = { credentials: OdooCredentials }

/** Validate Odoo credentials by authenticating; returns basic store info. */
const validateOdooConnectionStep = createStep(
  "validate-odoo-connection-step",
  async ({ credentials }: ValidateOdooInput) => {
    const client = new OdooApiClient(credentials)
    const info = await client.validateConnection()
    return new StepResponse(info)
  }
)

export default validateOdooConnectionStep
