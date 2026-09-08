import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"
import type { VendorRequest } from "../types"
import { resolveVendorSellerId } from "../hawala/seller-context"

type ShareBoxTemplateRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveShareBoxTemplate"]>
>

/**
 * Both spellings of the caller's seller id.
 *
 * The vendor middleware rewrites a `sel_*` actor to `mem_*` and keeps the
 * seller id on `_seller_id`, so a record written under one spelling must
 * still be found under the other. `order-cycles/route.ts` learned this the
 * hard way and its `sellerScopedCycleFilters` does the same union; a template
 * created before a coordinator's actor was rewritten would otherwise vanish
 * from their own list.
 */
export async function callerSellerIds(
  req: MedusaRequest
): Promise<string[]> {
  const actorId = (req as VendorRequest).auth_context?.actor_id
  const resolved = await resolveVendorSellerId(req)
  return Array.from(
    new Set([actorId, resolved].filter((id): id is string => Boolean(id)))
  )
}

/**
 * Resolve one template the caller actually owns.
 *
 * On denial this sends the response and returns `null`, so callers use:
 *
 *   const owned = await resolveOwnedTemplate(req, res)
 *   if (!owned) return
 *
 * A template belongs to exactly one coordinator, so ownership IS the whole
 * authorization rule here — there is no participant tier as there is on a
 * cycle. A template the caller does not own returns 404, not 403: a
 * coordinator has no business learning which template ids exist.
 */
export async function resolveOwnedTemplate(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<{ sellerIds: string[]; template: ShareBoxTemplateRecord } | null> {
  const sellerIds = await callerSellerIds(req)
  if (sellerIds.length === 0) {
    res.status(401).json({ message: "Unauthorized" })
    return null
  }

  const service = req.scope.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)

  let template: ShareBoxTemplateRecord
  try {
    template = await service.retrieveShareBoxTemplate(req.params.id)
  } catch (_error) {
    res.status(404).json({ message: "Share box template not found" })
    return null
  }

  if (!sellerIds.includes(template.coordinator_seller_id)) {
    res.status(404).json({ message: "Share box template not found" })
    return null
  }

  return { sellerIds, template }
}
