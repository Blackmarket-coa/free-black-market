import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getBridgeHealth } from "../../../../../modules/hawala-ledger/health"
import { createStellarSettlementService } from "../../../../../modules/hawala-ledger/stellar-settlement"

/**
 * GET /admin/hawala/bridge/health
 * Stellar/USDC bridge health for ops dashboards — the route
 * modules/hawala-ledger/health.ts has documented since it landed.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = createStellarSettlementService()
    const health = await getBridgeHealth({ service })
    res.json(health)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read bridge health"
    res.status(500).json({ error: message })
  }
}
