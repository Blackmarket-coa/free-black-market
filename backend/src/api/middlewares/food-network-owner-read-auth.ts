import { authenticate } from "@medusajs/framework/http"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http"

/**
 * Food-network reads that are kept for a record's owner: know who is asking.
 *
 * The framework identifies a *customer* on every /store route, optionally
 * (`router.js`: `authenticate("customer", ["bearer", "session"],
 * { allowUnauthenticated: true })`), and nobody else. The community-write
 * matchers in `api/middlewares.ts` admit a seller or a driver on the write
 * verbs, so one can register a courier, own a producer or plan a batch, and
 * was then nobody on GET: `auth_context` was unset, and every read below that
 * is kept for the record's owner refused the seller or driver who owns it.
 * Seen on Postgres with a real seller token (SD-110 (ii)): `POST
 * /store/couriers` 201 with the seller's actor id as `owner_id`, `POST
 * /store/couriers/:id/shifts` 201, and `GET` of the same shifts 403.
 *
 * **This identifies a caller and admits nobody.** It is optional, exactly as
 * the framework's own is, because these prefixes also carry the public
 * catalogue reads (the courier and producer lists and details), which stay
 * open to a caller with no account. A missing, forged or expired token, or a
 * token of an actor type not listed, leaves `auth_context` as the framework
 * left it and the request goes on: `authenticate` answers 401 only without
 * `allowUnauthenticated`.
 *
 * **And only a caller the framework identified as nobody.** A request it has
 * already made a customer is passed on untouched, so nothing changes for a
 * customer on these reads. Run unconditionally, `authenticate` looks at the
 * session before the bearer token, and a request carrying a seller's session
 * beside a customer's token would have turned from the customer into the
 * seller: the recipient of a delivery refused their own tracking.
 *
 * What a handler does with the actor is the handler's: every GET under these
 * prefixes that reads `auth_context` compares the actor's id with an owner
 * column (`food_producer.owner_id`, `food_courier.owner_id`,
 * `food_delivery_batch.owner_id`), each stamped from the creating account of
 * whatever type, or with `food_order.customer_id`, which only ever holds the
 * id of a signed-in customer (`actingCustomerId`) and so never matches a
 * seller or a driver. `food-network-owner-read-auth.unit.spec.ts` lists the
 * handlers.
 *
 * Method-scoped on purpose: Medusa registers a matcher that names methods
 * with `app[method](matcher)` and sorts it ahead of the route it guards
 * (`routes-sorter.js`: wildcard before static before params, middleware
 * before routes), and one with no method with `app.use`, ahead of everything.
 * GET only, so the write verbs keep their own, required, authenticate.
 *
 * The actor types are passed in rather than listed again here: they are the
 * ones the write matchers admit (`COMMUNITY_WRITE_ACTORS`), and an actor who
 * may create a record must be the one identified when reading it back.
 */
export const FOOD_NETWORK_OWNER_READ_PREFIXES = [
  "/store/food-producers",
  "/store/couriers",
  "/store/food-trades",
  "/store/food-deliveries",
  "/store/food-donations",
  "/store/delivery-batches",
] as const

export function foodNetworkOwnerReadAuthMatchers(actorTypes: string[]): MiddlewareRoute[] {
  const identify = authenticate(actorTypes, ["bearer", "session"], {
    allowUnauthenticated: true,
  })
  const identifyIfNobody = (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const known = (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context
    return known?.actor_id ? next() : identify(req, res, next)
  }
  return FOOD_NETWORK_OWNER_READ_PREFIXES.flatMap((prefix) =>
    [prefix, `${prefix}/**`].map((matcher) => ({
      matcher,
      method: ["GET" as const],
      middlewares: [identifyIfNobody],
    }))
  )
}
