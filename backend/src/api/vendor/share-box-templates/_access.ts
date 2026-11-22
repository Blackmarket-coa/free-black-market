import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"
import { getSellerId } from "../quests/_helpers"

type ShareBoxTemplateRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveShareBoxTemplate"]>
>

/**
 * The caller's store id, as a one-element list (empty when there is none):
 * what a template's `coordinator_seller_id` is compared with.
 *
 * It used to hold the caller's member id as well, because this surface stored
 * whichever spelling it saw (POST wrote the member id, the actor, first) and
 * behind the vendor gate that was the member id for every vendor: a template
 * belonged to the member who made it, and the store's other coordinators
 * never saw it (SD-145). Templates are now written under the store id, and
 * `scripts/rekey-member-keyed-store-data.ts` moves the ones written under a
 * member id onto its store.
 */
export async function callerSellerIds(
  req: MedusaRequest
): Promise<string[]> {
  const sellerId = await getSellerId(req)
  return sellerId ? [sellerId] : []
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
