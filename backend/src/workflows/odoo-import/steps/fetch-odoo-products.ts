import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { OdooApiClient } from "../../../modules/odoo-import/lib/odoo-api-client"
import type { OdooCredentials, OdooProduct } from "../../../modules/odoo-import/types"

export type FetchOdooProductsInput = { credentials: OdooCredentials }

/** Fetch all product templates from the vendor's Odoo instance. */
const fetchOdooProductsStep = createStep(
  "fetch-odoo-products-step",
  async ({ credentials }: FetchOdooProductsInput) => {
    const client = new OdooApiClient(credentials)
    const products: OdooProduct[] = await client.fetchAllProducts()
    return new StepResponse({ products })
  }
)

export default fetchOdooProductsStep
