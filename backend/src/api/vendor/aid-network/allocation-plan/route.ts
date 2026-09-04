import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AID_NETWORK_MODULE } from "../../../../modules/aid-network"
import type AidNetworkModuleService from "../../../../modules/aid-network/service"
import type { AllocationStrategy } from "../../../../modules/aid-network/allocation"
import { getSellerId } from "../../quests/_helpers"
import { parseDemands } from "../_helpers"

const STRATEGIES = new Set<AllocationStrategy>(["local_first", "expiry_first"])

interface PlanBody {
  demands?: unknown
  strategy?: string
  max_distance_km?: number
  now?: string
}

/**
 * POST /vendor/aid-network/allocation-plan — which stock should move where.
 *
 * POST rather than GET because the demand list is the payload, but the call is
 * read-only: it writes nothing and is deterministic, so it can be re-run and
 * diffed before anyone approves a transfer.
 */
export const POST = async (req: MedusaRequest<PlanBody>, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as PlanBody)

  const parsed = parseDemands(b.demands)
  if ("error" in parsed) return res.status(400).json({ message: parsed.error })
  if (parsed.demands.length === 0) {
    return res.status(400).json({ message: "at least one demand is required" })
  }

  if (b.strategy !== undefined && !STRATEGIES.has(b.strategy as AllocationStrategy)) {
    return res
      .status(400)
      .json({ message: `strategy must be one of: ${[...STRATEGIES].join(", ")}` })
  }
  if (
    b.max_distance_km !== undefined &&
    (typeof b.max_distance_km !== "number" || !(b.max_distance_km > 0))
  ) {
    return res
      .status(400)
      .json({ message: "max_distance_km must be a positive number" })
  }

  const service = req.scope.resolve<AidNetworkModuleService>(AID_NETWORK_MODULE)
  const plan = await service.planAllocation(sellerId, parsed.demands, {
    strategy: b.strategy as AllocationStrategy | undefined,
    max_distance_km: b.max_distance_km ?? null,
    now: b.now,
  })

  res.json({
    plan,
    // Surfaced so a planning view does not have to scan the whole plan.
    transfer_count: plan.allocations.filter((a) => !a.is_local).length,
    unmet_count: plan.unmet.length,
  })
}
