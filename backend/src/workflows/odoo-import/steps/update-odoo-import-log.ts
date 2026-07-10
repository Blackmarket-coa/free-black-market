import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ODOO_IMPORT_MODULE } from "../../../modules/odoo-import"
import OdooImportModuleService from "../../../modules/odoo-import/service"
import { OdooImportStatus, type OdooImportResult } from "../../../modules/odoo-import/types"

export type UpdateOdooImportLogInput = {
  import_log_id: string
  status: OdooImportStatus
  result?: OdooImportResult
}

async function doUpdate(input: UpdateOdooImportLogInput, container: any) {
  const svc: OdooImportModuleService = container.resolve(ODOO_IMPORT_MODULE)
  const updateData: any = { id: input.import_log_id, status: input.status }

  if (input.status === OdooImportStatus.IN_PROGRESS) {
    updateData.started_at = new Date()
  }
  if (
    input.status === OdooImportStatus.COMPLETED ||
    input.status === OdooImportStatus.FAILED
  ) {
    updateData.completed_at = new Date()
  }
  if (input.result) {
    updateData.imported_count = input.result.imported
    updateData.updated_count = input.result.updated
    updateData.failed_count = input.result.failed
    updateData.skipped_count = input.result.skipped
    updateData.error_details =
      input.result.errors.length > 0 ? input.result.errors : null
  }

  return svc.updateOdooImportLogs(updateData)
}

/** Mark import in-progress; compensation flips it to FAILED on downstream error. */
export const markOdooImportStartedStep = createStep(
  "mark-odoo-import-started-step",
  async (input: UpdateOdooImportLogInput, { container }) => {
    const updated = await doUpdate(input, container)
    return new StepResponse(updated, input.import_log_id)
  },
  async (importLogId, { container }) => {
    if (!importLogId) return
    try {
      await doUpdate(
        { import_log_id: importLogId, status: OdooImportStatus.FAILED },
        container
      )
    } catch {
      // best effort
    }
  }
)

export const markOdooImportCompletedStep = createStep(
  "mark-odoo-import-completed-step",
  async (input: UpdateOdooImportLogInput, { container }) => {
    const updated = await doUpdate(input, container)
    return new StepResponse(updated)
  }
)
