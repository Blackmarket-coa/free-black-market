import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../../../modules/order-cycle/service"

type Body = { variant_id?: unknown; quantity?: unknown }

/**
 * POST /store/order-cycles/:id/availability — may this variant go in a cart?
 *
 * Exposes `checkProductAvailability`, which had zero callers anywhere in the
 * repo. It already knew every rule that matters — the cycle must be open, the
 * product must be in the cycle and visible, and the request must fit within
 * `available_quantity - sold_quantity` — and returned a human-readable reason
 * and a `maxQuantity`, all of it unreachable. A cycle's stated limits were
 * decorative because nothing asked.
 *
 * A storefront asks before adding, so a refusal costs the buyer nothing: there
 * is no item in the cart to take back out.
 *
 * This is a check, not a reservation. Two buyers can pass it at the same
 * instant, and `recordSale` increments `sold_quantity` without re-checking, so
 * a cycle can still oversell under concurrency. That race is recorded in
 * `docs/AUDIT_DEBT.md` rather than half-solved here — a real fix is a
 * reservation decision, not a guard.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "order cycle id is required" })

  const body = (req.validatedBody || req.body || {}) as Body

  const variantId = body.variant_id
  if (typeof variantId !== "string" || variantId.length === 0) {
    return res.status(400).json({ message: "variant_id is required" })
  }

  const rawQuantity = body.quantity
  if (rawQuantity !== undefined) {
    if (
      typeof rawQuantity !== "number" ||
      !Number.isInteger(rawQuantity) ||
      rawQuantity <= 0
    ) {
      return res
        .status(400)
        .json({ message: "quantity must be a whole number above zero" })
    }
  }
  const quantity = typeof rawQuantity === "number" ? rawQuantity : 1

  const orderCycleService =
    req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  let result: { available: boolean; reason?: string; maxQuantity?: number }
  try {
    result = await orderCycleService.checkProductAvailability(id, variantId, quantity)
  } catch {
    // `checkProductAvailability` retrieves the cycle first, so an unknown id
    // throws rather than returning `available: false`.
    return res.status(404).json({ message: "Order cycle not found" })
  }

  // 200 either way: "you cannot order five of these" is an answer, not a fault.
  // The caller acts on `available`, and gets the cycle's own wording for why.
  return res.json({
    available: result.available,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.maxQuantity !== undefined ? { max_quantity: result.maxQuantity } : {}),
    variant_id: variantId,
    quantity,
  })
}
