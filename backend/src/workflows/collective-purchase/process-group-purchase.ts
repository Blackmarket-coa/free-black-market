import { createLogger } from "../../shared/logger"
const log = createLogger("workflows/collective-purchase/process-group-purchase")
import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { getCollectiveHawalaService } from "../../services/collective-hawala"

type ProcessGroupPurchaseInput = {
  demand_post_id: string
  supplier_id: string
  total_amount: number
  platform_fee_percentage: number
}

const processGroupPurchaseStep = createStep(
  "process-group-purchase-step",
  async (input: ProcessGroupPurchaseInput, { container }) => {
    const hawalaService = getCollectiveHawalaService(container)

    const result = await hawalaService.processGroupPurchase({
      demand_post_id: input.demand_post_id,
      supplier_id: input.supplier_id,
      total_amount: input.total_amount,
      platform_fee_percentage: input.platform_fee_percentage,
    })

    return new StepResponse(result, input.demand_post_id)
  },
  async (demandPostId, { container }) => {
    if (!demandPostId) return
    // Note: Financial reversals should be handled via refund process
    log.info(
      `[process-group-purchase] Compensation triggered for demand post ${demandPostId}. Manual review required for financial reversal.`
    )
  }
)

export const processGroupPurchaseWorkflow = createWorkflow(
  "process-group-purchase-workflow",
  (input: ProcessGroupPurchaseInput) => {
    const result = processGroupPurchaseStep(input)
    return new WorkflowResponse(result)
  }
)
