import {
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { WOOCOMMERCE_IMPORT_MODULE } from "../../../modules/woocommerce-import"
import WooCommerceImportModuleService from "../../../modules/woocommerce-import/service"
import { ImportStatus, type ImportResult } from "../../../modules/woocommerce-import/types"

export type UpdateImportLogInput = {
  import_log_id: string
  status: ImportStatus
  result?: ImportResult
}

async function doUpdateImportLog(
  input: UpdateImportLogInput,
  container: any
) {
  const wooService: WooCommerceImportModuleService = container.resolve(
    WOOCOMMERCE_IMPORT_MODULE
  )

  const updateData: any = {
    id: input.import_log_id,
    status: input.status,
  }

  if (input.status === ImportStatus.IN_PROGRESS) {
    updateData.started_at = new Date()
  }

  if (
    input.status === ImportStatus.COMPLETED ||
    input.status === ImportStatus.FAILED
  ) {
    updateData.completed_at = new Date()
  }

  if (input.result) {
    // Updated products are successful, non-failed work; fold them into the
    // imported tally so the persisted log reflects everything processed.
    updateData.imported_count =
      input.result.imported + (input.result.updated ?? 0)
    updateData.failed_count = input.result.failed
    updateData.skipped_count = input.result.skipped
    updateData.error_details = input.result.errors.length > 0
      ? input.result.errors
      : null
  }

  return wooService.updateWooCommerceImportLogs(updateData)
}

/**
 * Step to mark import as started (in-progress).
 *
 * Compensation flips the log to FAILED if a later step throws. Without it a
 * transient fetch error left the log stuck IN_PROGRESS forever, and the
 * "one import at a time" guard then rejected every future import for the vendor.
 */
export const markImportStartedStep = createStep(
  "mark-import-started-step",
  async (input: UpdateImportLogInput, { container }) => {
    const updated = await doUpdateImportLog(input, container)
    return new StepResponse(updated, input.import_log_id)
  },
  async (importLogId, { container }) => {
    if (!importLogId) return
    try {
      await doUpdateImportLog(
        { import_log_id: importLogId, status: ImportStatus.FAILED },
        container
      )
    } catch {
      // Best-effort: never let compensation itself throw.
    }
  }
)

/**
 * Step to mark import as completed/failed with results.
 */
export const markImportCompletedStep = createStep(
  "mark-import-completed-step",
  async (input: UpdateImportLogInput, { container }) => {
    const updated = await doUpdateImportLog(input, container)
    return new StepResponse(updated)
  }
)
