import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createBugReportHandler } from "../../../shared/bug-report-handler"

const handler = createBugReportHandler({ source: "storefront" })

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handler(req, res)
}
