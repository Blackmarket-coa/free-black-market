import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import fetchOdooProductsStep from "./steps/fetch-odoo-products"
import transformAndCreateOdooProductsStep from "./steps/transform-and-create-odoo-products"
import {
  markOdooImportStartedStep,
  markOdooImportCompletedStep,
} from "./steps/update-odoo-import-log"
import { OdooImportStatus } from "../../modules/odoo-import/types"
import type { OdooCredentials } from "../../modules/odoo-import/types"

type ImportOdooProductsInput = {
  credentials: OdooCredentials
  seller_id: string
  currency: string
  import_as_draft: boolean
  import_log_id: string
}

export const importOdooProductsWorkflow = createWorkflow(
  "import-odoo-products",
  (input: ImportOdooProductsInput) => {
    markOdooImportStartedStep({
      import_log_id: input.import_log_id,
      status: OdooImportStatus.IN_PROGRESS,
    })

    const fetchResult = fetchOdooProductsStep({ credentials: input.credentials })

    const importResult = transformAndCreateOdooProductsStep({
      products: fetchResult.products,
      seller_id: input.seller_id,
      currency: input.currency,
      import_as_draft: input.import_as_draft,
    })

    const finalLogUpdate = transform(
      { importResult, import_log_id: input.import_log_id },
      (data) => ({
        import_log_id: data.import_log_id,
        status:
          data.importResult.failed > 0 &&
          data.importResult.imported === 0 &&
          data.importResult.updated === 0
            ? OdooImportStatus.FAILED
            : OdooImportStatus.COMPLETED,
        result: data.importResult,
      })
    )

    markOdooImportCompletedStep(finalLogUpdate)

    return new WorkflowResponse({ result: importResult })
  }
)

export default importOdooProductsWorkflow
