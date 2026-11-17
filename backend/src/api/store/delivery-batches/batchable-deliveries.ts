import type { MedusaRequest } from "@medusajs/framework/http"
import { actorMayReadDelivery } from "../../../shared/community-read-access"
import { retrieveDeliveryOrNull } from "../../../modules/food-distribution/proof-of-delivery"

type BatchableDelivery = {
  id: string
  batch_id?: string | null
  producer_id?: string | null
  courier_id?: string | null
  order_id?: string | null
}

/**
 * The deliveries named, when the caller may put every one of them in a batch;
 * null when any one of them is missing or is not the caller's to batch.
 *
 * **Interim rule (SD-107): a caller may batch only a delivery they may
 * already read** (`actorMayReadDelivery`: its producer, its courier, its
 * recipient). Batching is how a delivery's address reaches a batch's planner
 * and its courier (`GET /store/delivery-batches/:id` serves both), and the
 * batch routes checked that a delivery existed and was un-batched, not whose
 * it was: with `FF_PICK_PACK_V1` on, any signed-in account could batch
 * anyone's delivery and read where it was going.
 *
 * Who SHOULD be able to batch a delivery (its producer only, a courier, a
 * community organiser running a food-bank round) is the operator's ruling and
 * is not made here. This rule needs none: it hands nobody anything they
 * could not read before.
 *
 * Null carries no reason on purpose. The caller answers it with `forbidden()`,
 * so a delivery that does not exist and one that belongs to someone else are
 * refused alike; whether a delivery is already in a batch is checked only
 * after this, so only someone entitled to it is told.
 *
 * Each delivery is returned once however often it is named. An id sent twice
 * passed twice, and the batch was created with a `total_deliveries` (and add
 * with a sequence) one higher than the deliveries in it. Callers write from
 * the list returned here, not from the ids they were sent.
 */
export async function deliveriesActorMayBatch<T extends BatchableDelivery>(
  req: MedusaRequest,
  service: { retrieveFoodDelivery: (id: string) => Promise<T> },
  deliveryIds: readonly string[]
): Promise<T[] | null> {
  const deliveries: T[] = []
  for (const deliveryId of new Set(deliveryIds)) {
    const delivery = await retrieveDeliveryOrNull(service, deliveryId)
    if (!delivery || !(await actorMayReadDelivery(req, delivery))) {
      return null
    }
    deliveries.push(delivery)
  }
  return deliveries
}
