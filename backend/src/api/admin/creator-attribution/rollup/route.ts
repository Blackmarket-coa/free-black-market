import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/admin/creator-attribution/rollup")
import { z } from "zod"
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../../modules/creator-attribution"
import CreatorAttributionService from "../../../../modules/creator-attribution/service"

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

/**
 * GET /admin/creator-attribution/rollup
 *   ?from=ISO8601&to=ISO8601
 *
 * Platform-wide creator-driven-sales KPI — the single number the founder
 * wants to watch: total attributed GMV and commission across all creators,
 * broken down by attribution source.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const query = querySchema.parse(req.query)
    const from = query.from ? new Date(query.from) : undefined
    const to = query.to ? new Date(query.to) : undefined

    const service = req.scope.resolve<CreatorAttributionService>(
      CREATOR_ATTRIBUTION_MODULE
    )

    const rollup = await service.platformAttributionRollup({ from, to })

    return res.status(200).json({ rollup })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ message: "Validation failed", details: error.issues })
    }
    log.error("[GET /admin/creator-attribution/rollup] Error:", error.message)
    return res.status(400).json({ message: error.message })
  }
}
