import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "./logger"

const log = createLogger("shared/community-read-access")

/**
 * Who may read a community record that is about a person.
 *
 * ## The ruling D10-5 asked for
 *
 * `docs/AUDIT_DEBT.md` D10-5 listed unauthenticated `/store/*` reads that each
 * return personal data belonging to someone other than the caller, and
 * deferred them all: "which of these are meant to be public at all, and for
 * the rest, whether the reader must be the owner, a member of the same
 * garden/network, or the subject". That question is answered here, once, so
 * ten routes cannot answer it ten different ways.
 *
 * **A `/store/*` read that returns a natural person's identifying, locating,
 * financial or participation data is scoped to someone entitled to it.** Three
 * tiers, in the order a route should try them:
 *
 * 1. **The subject or a principal of the record** — the person it is about, or
 *    the producer/courier who has to act on it. `actorIsAnyOf`.
 * 2. **A member of the same garden** — a roster is legitimately visible to the
 *    people on it. That is what a community garden is, and hiding co-members
 *    from each other would break the thing rather than protect it.
 *    `actorIsGardenMember`.
 * 3. **Nobody else.** 403, not 404-vs-403: see `forbidden` below.
 *
 * Tier 2 is deliberately *membership*, not merely being signed in. An account
 * with no relationship to a garden is a stranger to its roster.
 *
 * ## What this does not decide
 *
 * It does not make anything public. Where a genuinely public surface exists,
 * the answer is a projection — `modules/food-distribution/public-view.ts`
 * holds those, and D10-5a's courier view is the worked example. A projection
 * and a scope are different tools: a projection narrows *what* is returned, a
 * scope narrows *who* may ask. Several of these routes want both.
 */

type AuthContext = { actor_id?: string; actor_type?: string }

/** The authenticated actor id of any type (customer, seller, driver), or null. */
export function actorId(req: MedusaRequest): string | null {
  const ctx = (req as unknown as { auth_context?: AuthContext }).auth_context
  return typeof ctx?.actor_id === "string" && ctx.actor_id.length > 0
    ? ctx.actor_id
    : null
}

/**
 * True when the actor is one of the principals named on a record.
 *
 * Nullish candidates are ignored rather than matched, so a record with a null
 * `courier_id` does not become readable by an unauthenticated caller — the
 * same trap `actorMayManage` deliberately grandfathers and `actorOwnsResource`
 * deliberately does not. Reads take the strict reading.
 */
export function actorIsAnyOf(
  req: MedusaRequest,
  ...candidates: Array<string | null | undefined>
): boolean {
  const id = actorId(req)
  if (!id) return false
  return candidates.some((candidate) => !!candidate && candidate === id)
}

/**
 * True when the actor holds a membership in this garden.
 *
 * Any membership counts, including a lapsed or pending one: the question is
 * "is this person part of this garden", not "are they in good standing", and
 * a route that needs the stricter reading should check the status itself.
 *
 * Never throws — a lookup failure denies rather than admits, and is logged so
 * a misconfigured module surfaces as an operator problem instead of as an
 * open door.
 */
export async function actorIsGardenMember(
  req: MedusaRequest,
  gardenId: string | null | undefined
): Promise<boolean> {
  const id = actorId(req)
  if (!id || !gardenId) return false

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "garden_membership",
      fields: ["id"],
      filters: { garden_id: gardenId, customer_id: id },
    })
    return Array.isArray(data) && data.length > 0
  } catch (error) {
    log.warn(
      `[community-read-access] membership lookup failed for garden ${gardenId}: ${
        (error as Error)?.message ?? error
      }`
    )
    return false
  }
}

/**
 * The single refusal shape for all of these routes.
 *
 * **Always 403, never 404**, and deliberately the same body whether the record
 * is missing or merely not the caller's. Ids are enumerable throughout this
 * API — each prefix's own list endpoint supplies them — so a 404 that meant
 * "no such delivery" and a 403 that meant "not yours" would together turn
 * these endpoints into an existence oracle: walk the id space, and the status
 * code tells you which records are real. One code for both says nothing.
 */
export function forbidden(res: {
  status: (code: number) => { json: (body: unknown) => unknown }
}): unknown {
  return res.status(403).json({
    message: "You do not have access to this record.",
    type: "not_allowed",
  })
}

/**
 * True when the actor owns the food producer named.
 *
 * The producer-scoped operational lists (deliveries, trades, donations) are a
 * seller's own workload, and `food_producer.owner_id` is the account that
 * manages it — the same key `/store/food-producers/:id/orders` was fixed to
 * use in D10-1. A null `owner_id` is refused rather than grandfathered
 * (`actorIsAnyOf` ignores nullish candidates): on a PII read a legacy producer
 * with no owner stamped must not become everyone's.
 *
 * Denies on lookup failure, and never throws.
 */
export async function actorOwnsProducer(
  req: MedusaRequest,
  producerId: string | null | undefined
): Promise<boolean> {
  if (!actorId(req) || !producerId) return false
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "food_producer",
      fields: ["id", "owner_id"],
      filters: { id: producerId },
    })
    const ownerId = (data?.[0] as { owner_id?: string | null } | undefined)?.owner_id
    return actorIsAnyOf(req, ownerId)
  } catch (error) {
    log.warn(
      `[community-read-access] producer ownership lookup failed for ${producerId}: ${
        (error as Error)?.message ?? error
      }`
    )
    return false
  }
}

/**
 * True when the actor owns the courier named — the other principal on a
 * delivery, who has to be able to read the run they are driving.
 */
export async function actorOwnsCourier(
  req: MedusaRequest,
  courierId: string | null | undefined
): Promise<boolean> {
  if (!actorId(req) || !courierId) return false
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "food_courier",
      fields: ["id", "owner_id"],
      filters: { id: courierId },
    })
    const ownerId = (data?.[0] as { owner_id?: string | null } | undefined)?.owner_id
    return actorIsAnyOf(req, ownerId)
  } catch (error) {
    log.warn(
      `[community-read-access] courier ownership lookup failed for ${courierId}: ${
        (error as Error)?.message ?? error
      }`
    )
    return false
  }
}

/**
 * Who may read one delivery: its producer, its courier, or its recipient.
 *
 * `food_delivery` names the producer and courier directly but reaches the
 * recipient only through `order_id` → `food_order.customer_id`, so that hop
 * is made here rather than in four routes.
 *
 * This is the check behind the sharpest item in D10-5. `/track` and
 * `/subscribe` were unauthenticated over enumerable ids and returned a
 * delivery address, its coordinates, the live position of the courier heading
 * there and an ETA — the SSE one continuously. Whatever the audience for a
 * tracking link should be, walking the id space is not it.
 *
 * A recipient who checked out as a guest has a null `customer_id` and cannot
 * be matched. They lose tracking rather than everyone gaining it; giving them
 * it back means a per-delivery token on the link, which is a feature, not a
 * default.
 */
export async function actorMayReadDelivery(
  req: MedusaRequest,
  delivery: {
    producer_id?: string | null
    courier_id?: string | null
    order_id?: string | null
  }
): Promise<boolean> {
  if (!actorId(req)) return false

  if (
    (await actorOwnsProducer(req, delivery.producer_id)) ||
    (await actorOwnsCourier(req, delivery.courier_id))
  ) {
    return true
  }

  if (!delivery.order_id) return false
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "food_order",
      fields: ["id", "customer_id"],
      filters: { id: delivery.order_id },
    })
    const customerId = (data?.[0] as { customer_id?: string | null } | undefined)
      ?.customer_id
    return actorIsAnyOf(req, customerId)
  } catch (error) {
    log.warn(
      `[community-read-access] recipient lookup failed for order ${delivery.order_id}: ${
        (error as Error)?.message ?? error
      }`
    )
    return false
  }
}
