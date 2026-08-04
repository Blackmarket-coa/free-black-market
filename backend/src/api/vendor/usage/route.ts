import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { createLogger } from "../../../shared/logger"
import { requireSellerId } from "../../../shared"
import { collectSellerUsage } from "../../../shared/plan-usage"

const log = createLogger("api/vendor/usage")

/**
 * GET /vendor/usage — where this vendor stands against their plan allowances.
 *
 * The missing half of the Phase 1 caps: those deny with a 402 at the moment a
 * create fails, which is the first and last warning a vendor gets. This is the
 * warning that comes earlier.
 *
 * Not plan-gated, and deliberately so — a vendor on the smallest plan is the
 * one most likely to be near a ceiling, so gating this would hide the number
 * from exactly the people who need it. Same reasoning as `/vendor/billing`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const usage = await collectSellerUsage(req.scope, sellerId)
    return res.json(usage)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/usage] failed", message)
    return res
      .status(500)
      .json({ type: "server_error", message: "Failed to load usage" })
  }
}
