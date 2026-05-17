import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createBugReportHandler } from "../../../shared/bug-report-handler"

const handler = createBugReportHandler({
  source: "admin-panel",
  extraContext: (req) => {
    const authContext = (req as MedusaRequest & {
      auth_context?: { actor_id?: string }
    }).auth_context
    return { "Admin user ID": authContext?.actor_id }
  },
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  return handler(req, res)
}
