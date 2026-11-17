import { createLogger } from "../../../shared/logger"
const log = createLogger("api/admin/backfill-seller-auth")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { backfillSellerAuthLinks } from "../../../shared/seller-auth-backfill"

/**
 * POST /admin/backfill-seller-auth
 *
 * One-time endpoint to fix existing sellers whose auth_identity
 * records are missing the seller_id in app_metadata. Links each such login to
 * its MEMBER, as Mercur's own workflows do, and only through members still on
 * the team of stores still open (shared/seller-auth-backfill.ts).
 *
 * Run via: curl -X POST https://your-backend/admin/backfill-seller-auth -H "Authorization: Bearer <token>"
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const details: string[] = []
  try {
    const summary = await backfillSellerAuthLinks(req.scope, (line) => details.push(line))
    res.json({ success: true, summary, details })
  } catch (error) {
    log.error("Backfill error:", error)
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      details,
    })
  }
}
