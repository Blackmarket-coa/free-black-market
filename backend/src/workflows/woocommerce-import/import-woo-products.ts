import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import fetchWooProductsStep from "./steps/fetch-woo-products"
import transformAndCreateProductsStep from "./steps/transform-and-create-products"
import { markImportStartedStep, markImportCompletedStep } from "./steps/update-import-log"
import { ImportStatus } from "../../modules/woocommerce-import/types"
import type { WooCredentials } from "../../modules/woocommerce-import/types"

type ImportWooProductsInput = {
  credentials: WooCredentials
  seller_id: string
  currency: string
  import_as_draft: boolean
  import_log_id: string
}

export const importWooProductsWorkflow = createWorkflow(
  "import-woo-products",
  (input: ImportWooProductsInput) => {
    // Step 1: Mark import as in-progress
    markImportStartedStep({
      import_log_id: input.import_log_id,
      status: ImportStatus.IN_PROGRESS,
    })

    // Step 2: Fetch all products from WooCommerce
    const fetchResult = fetchWooProductsStep({
      credentials: input.credentials,
    })

    // Step 3: Transform and create products in Medusa
    const importResult = transformAndCreateProductsStep({
      products: fetchResult.products,
      variations_map: fetchResult.variations_map,
      seller_id: input.seller_id,
      currency: input.currency,
      import_as_draft: input.import_as_draft,
    })

    // Step 4: Mark import as completed with results
    const finalLogUpdate = transform(
      { importResult, import_log_id: input.import_log_id },
      (data) => ({
        import_log_id: data.import_log_id,
        status:
          data.importResult.failed > 0 &&
          data.importResult.imported === 0 &&
          data.importResult.updated === 0
            ? ImportStatus.FAILED
            : ImportStatus.COMPLETED,
        result: data.importResult,
      })
    )

    markImportCompletedStep(finalLogUpdate)

    return new WorkflowResponse({
      result: importResult,
    })
  }
)

export default importWooProductsWorkflow
