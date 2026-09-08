import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../modules/order-cycle/service"
import { resolveCycleAccess, type CycleAccess } from "../../_access"

type ShareBoxRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveShareBox"]>
>

/**
 * Resolve one share box inside a cycle the caller coordinates.
 *
 * Coordinator-only, deliberately. Generating, packing and dispatching are the
 * coordinator's acts, and a box carries `customer_id` — so letting a
 * participant seller read them would show them other members' box contents.
 *
 * The box must belong to the cycle named in the path. This is the fourth child
 * route on this surface to need that check: the fees route's predecessor
 * "deleted by global feeId while ignoring :id entirely",
 * `exchanges/:exchangeId/products` had no gate at all, and the products DELETE
 * added in #839 needed the same. Without it a guessed `:id`/`:boxId` pair acts
 * on a stranger's box.
 */
export async function resolveOwnedShareBox(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<{ access: CycleAccess; box: ShareBoxRecord } | null> {
  const { id, boxId } = req.params

  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: true,
  })
  if (!access) return null

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  let box: ShareBoxRecord
  try {
    box = await service.retrieveShareBox(boxId)
  } catch (_error) {
    res.status(404).json({ message: "Share box not found" })
    return null
  }

  if (box.order_cycle_id !== id) {
    res.status(404).json({ message: "Share box not found" })
    return null
  }

  return { access, box }
}

/**
 * Apply a lifecycle transition, or answer 409 with why it is not allowed.
 *
 * The service's `mark*` methods write `status` unconditionally; the transition
 * table on the service is the rule, and this is the one place the routes ask
 * it. Returns true when the caller should proceed.
 */
export function guardTransition(
  res: MedusaResponse,
  service: typeof OrderCycleModuleService,
  from: string,
  to: string
): boolean {
  if (service.canTransitionShareBox(from, to)) return true

  res.status(409).json({
    message: `A ${from} share box cannot be marked ${to}.`,
    from,
    to,
  })
  return false
}
