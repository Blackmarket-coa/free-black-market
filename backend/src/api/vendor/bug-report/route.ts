import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createBugReportHandler } from "../../../shared/bug-report-handler"

function getSellerId(req: MedusaRequest): string | undefined {
  const authContext = (req as MedusaRequest & {
    auth_context?: { actor_id?: string }
  }).auth_context
  const sellerHint = (req as MedusaRequest & { _seller_id?: string })._seller_id
  return sellerHint || authContext?.actor_id
}

const handler = createBugReportHandler({
  source: "vendor-panel",
  extraLabels: (req) => {
    const sellerId = getSellerId(req)
    return sellerId ? [`seller:${sellerId}`] : []
  },
  extraContext: (req) => ({
    "Seller ID": getSellerId(req),
  }),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handler(req, res)
}
