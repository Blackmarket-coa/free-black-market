import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE } from "../../../../../modules/vendor-hype-operations-prediction"
import VendorHypeOperationsPredictionService from "../../../../../modules/vendor-hype-operations-prediction/service"

const querySchema = z.object({
  execution_run_id: z.string().min(1),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const actorType = (req as any).auth_context?.actor_type
  if (actorType && actorType !== "admin") {
    return res.status(403).json({ error: "Forbidden" })
  }

  const query = querySchema.parse(req.query)
  const service = req.scope.resolve<VendorHypeOperationsPredictionService>(
    VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE
  )

  const payouts = await service.listPredictionPayoutEntries({})
  const matching = payouts.filter((payout) => {
    const runId = (payout.metadata as any)?.payout_processing?.execution_run_id
    return runId === query.execution_run_id
  })

  const summary = {
    total: matching.length,
    credited: matching.filter((item) => item.payout_status === "credited").length,
    failed: matching.filter((item) => item.payout_status === "failed").length,
    computed: matching.filter((item) => item.payout_status === "computed").length,
  }

  res.json({
    execution_run_id: query.execution_run_id,
    summary,
    payouts: matching,
  })
}
