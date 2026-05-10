import { StellarSettlementService } from "./stellar-settlement"
import type { BridgeHealthSnapshot } from "./dual-rail-selector"

/**
 * Snapshot the Stellar/USDC bridge health for the dual-rail selector and
 * for ops dashboards. Wraps Horizon access so a network outage cannot
 * crash the settlement job.
 *
 * The shape mirrors `BridgeHealthSnapshot` from `dual-rail-selector.ts`.
 * Operators consume this through `/admin/hawala/bridge/health` (added in
 * a follow-up route) or via the settlement-job logs.
 */
export async function getBridgeHealth(args: {
  service: StellarSettlementService
  lastBatchStatus?: "succeeded" | "pending" | "failed" | "unknown"
}): Promise<BridgeHealthSnapshot> {
  let horizon_reachable = false
  let usdc_balance = 0

  try {
    usdc_balance = await args.service.getUsdcBalance()
    horizon_reachable = true
  } catch {
    horizon_reachable = false
  }

  return {
    horizon_reachable,
    usdc_balance,
    last_batch_status: args.lastBatchStatus ?? "unknown",
  }
}
