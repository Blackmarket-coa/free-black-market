import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createBugReportConfigHandler } from "../../../../shared/bug-report-handler"

const handler = createBugReportConfigHandler()

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return handler(req, res)
}
