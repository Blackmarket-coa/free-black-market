import type { MedusaNextFunction, MedusaRequest, MedusaResponse, MiddlewareRoute } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createLogger } from "../../shared/logger"
import {
  CART_PAYMENT_AMOUNT_MISMATCH,
  type CartPaymentAmounts,
  cartPaymentAmountMismatchResponse,
  cartPaymentRefreshFailedResponse,
  judgeCartPaymentAmount,
} from "../../lib/cart-payment-amount"
import { refreshCartPaymentCollection } from "../../lib/cart-payment-refresh"

const log = createLogger("api/middlewares/cart-payment-refresh")

/**
 * SD-115: a cart's payment side is kept at the cart's total around the
 * routes of `@mercurjs/b2c-core` that change that total and leave it behind,
 * a completion on a session for another amount is refused, and a cart so
 * refused is left ready to be paid at its total. Why, and what each end
 * guarantees: `lib/cart-payment-amount.ts`.
 *
 * FBM cannot edit Mercur's routes and neither of its two workflows has a hook
 * that runs after its last write (`add-seller-shipping-method-to-cart`
 * declares none; Medusa's `addShippingMethodToCartWorkflow` inside it has
 * `validate`, which runs before, and refreshes the collection itself before
 * Mercur re-adds the other sellers' methods; `remove-cart-shipping-methods`
 * is one step). So these sit in front of the routes, as
 * `refuseUnfinishedCartCompletion` does, and act once the handler has
 * answered.
 */

const statusOf = (res: MedusaResponse): number => (res as unknown as { statusCode?: number }).statusCode ?? 200

type ShippingMethodRow = { id: string; cart_id?: string | null }
type CartModuleLike = {
  listShippingMethods: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<ShippingMethodRow[]>
}
type QueryLike = {
  graph: (args: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
}

const cartModule = (scope: MedusaRequest["scope"]) => scope.resolve(Modules.CART) as unknown as CartModuleLike
const queryOf = (scope: MedusaRequest["scope"]) => scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike

/**
 * Which shipping methods each cart holds, by id. Medusa's add replaces every
 * method (new ids) and its remove soft-deletes the ones named; a workflow
 * that failed restores what it removed and deletes what it added. So the ids
 * differ from before exactly when a write went through.
 */
async function shippingMethodIds(scope: MedusaRequest["scope"], cartIds: string[]): Promise<Map<string, string>> {
  const held = new Map<string, string[]>(cartIds.map((id) => [id, []]))
  if (cartIds.length) {
    const rows = await cartModule(scope).listShippingMethods({ cart_id: cartIds }, { select: ["id", "cart_id"], take: null })
    for (const row of rows) {
      if (row.cart_id) held.get(row.cart_id)?.push(row.id)
    }
  }
  return new Map([...held].map(([id, ids]) => [id, ids.sort().join(",")]))
}

/** The carts a request is about to write, read before the handler runs. */
type CartsOf = (req: MedusaRequest) => Promise<string[]>

/** `POST /store/carts/:id/shipping-methods`, `DELETE /store/carts/:id/line-items/:line_id` and `POST /store/carts/:id/taxes`: the cart in the path. */
const cartInPath: CartsOf = async (req) => {
  const id = String(req.params.id ?? "")
  return id ? [id] : []
}

/**
 * `DELETE /store/carts/:id/shipping-methods`: the carts that hold the methods
 * named in the body. Mercur's route hands the body's ids to its workflow and
 * never reads the cart in the path, so that is the cart written, whichever
 * one the path names. (A method's id is served only with its cart, so naming
 * another cart's method takes knowing that cart: nothing the caller could not
 * already do through that cart's own path.)
 */
const cartsOfNamedShippingMethods: CartsOf = async (req) => {
  const body = ((req as { validatedBody?: unknown }).validatedBody ?? req.body ?? {}) as { shipping_method_ids?: unknown }
  const ids = Array.isArray(body.shipping_method_ids)
    ? body.shipping_method_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : []
  if (!ids.length) return []
  const rows = await cartModule(req.scope).listShippingMethods({ id: ids }, { select: ["id", "cart_id"], take: null })
  return [...new Set(rows.map((row) => row.cart_id).filter((id): id is string => !!id))]
}

/**
 * The cart the handler put in its answer, read again with the handler's own
 * field list. Mercur's shipping-method routes read the cart before this
 * middleware refreshes its payment collection, so the collection (its amount,
 * and sessions the refresh has just deleted) would otherwise go out as it was
 * a moment ago. A cart with no collection has nothing the refresh could have
 * changed and is sent as the handler read it.
 */
async function withCartReadAgain(req: MedusaRequest, cartId: string, body: unknown): Promise<unknown> {
  const answered = (body as { cart?: { id?: string; payment_collection?: unknown } } | null)?.cart
  if (!answered || typeof answered !== "object" || answered.id !== cartId || !answered.payment_collection) return body
  const fields = (req as { queryConfig?: { fields?: string[] } }).queryConfig?.fields
  try {
    if (!fields?.length) throw new Error("the request carries no field list")
    const { data } = await queryOf(req.scope).graph({ entity: "cart", fields, filters: { id: cartId } })
    if (!data[0]) throw new Error("the cart was not found")
    return { ...(body as object), cart: data[0] }
  } catch (error) {
    // The refresh went through; only the second read failed. Nothing stale
    // is sent: the collection is left out, and a client reads it with the cart.
    log.error(
      `[cart-payment] cart ${cartId}: refreshed, but the cart could not be read again for the response, so its payment collection is left out: ${(error as Error)?.message ?? error}`
    )
    const { payment_collection: _stale, ...cart } = answered as Record<string, unknown>
    return { ...(body as object), cart }
  }
}

/**
 * Refresh the payment collection of the carts a route wrote, after its
 * handler has answered and before the answer goes out.
 *
 * - The handler answered a success: its write is done. Each cart is
 *   refreshed (`refreshCartPaymentCollection`: the collection takes the
 *   total and a session for another amount is deleted; a no-op when both
 *   already agree, or there is no collection yet), then the answer is sent. When a
 *   refresh fails the cart has changed and its payment has not, so the caller
 *   is not told it worked: the answer becomes 500
 *   `cart_payment_refresh_failed`, with a message that says to try again
 *   (repeating the request ends in the same refresh). The completion check
 *   below is what stands behind that: a session left for the old amount
 *   cannot be completed on.
 * - The handler answered an error. A workflow that failed has undone its
 *   write, and then nothing is refreshed. But the write can also have gone
 *   through and the handler failed after it, reading the cart for its
 *   response (SD-117: on the integration database these routes answer 500
 *   that way on every call). The carts' shipping methods are compared with
 *   what they were before the handler ran, and a cart whose methods changed
 *   is refreshed. The error is passed on as it is either way; a refresh that
 *   fails here is logged.
 *
 * When the carts' methods cannot be read before the handler runs, the
 * request goes on (a route that worked is not failed for this) and, should it
 * then answer an error, the cart in the path is refreshed without the
 * comparison: an unneeded refresh changes nothing, a missed one leaves a
 * stale session.
 */
export function refreshCartPaymentAfter(cartsOf: CartsOf) {
  return async function refreshCartPaymentAfterWrite(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> {
    const pathCart = String(req.params.id ?? "")
    let carts: string[] = pathCart ? [pathCart] : []
    let before: Map<string, string> | null = null
    try {
      carts = await cartsOf(req)
      before = await shippingMethodIds(req.scope, carts)
    } catch (error) {
      log.warn(
        `[cart-payment] cart ${pathCart}: could not read the shipping methods before ${req.method} ${req.path}; if it answers an error, the payment collection is refreshed without knowing whether it wrote: ${(error as Error)?.message ?? error}`
      )
    }

    const refresh = async (cartIds: string[]): Promise<string[]> => {
      const failed: string[] = []
      for (const cartId of cartIds) {
        try {
          await refreshCartPaymentCollection(req.scope, cartId)
        } catch (error) {
          failed.push(cartId)
          log.error(
            `[cart-payment] cart ${cartId}: its payment collection could not be refreshed after ${req.method} ${req.path}; a session opened before this request may be for an amount that is no longer the cart's total: ${(error as Error)?.message ?? error}`,
            { cart_id: cartId }
          )
        }
      }
      return failed
    }

    const writtenSince = async (): Promise<string[]> => {
      if (!before) return carts
      try {
        const after = await shippingMethodIds(req.scope, carts)
        return carts.filter((id) => after.get(id) !== before?.get(id))
      } catch {
        return carts
      }
    }

    const json = res.json.bind(res)
    let held = false
    res.json = ((body: unknown) => {
      // One answer is held. Anything sent while it is (there is nothing that
      // does) or after it goes straight out.
      if (held) return json(body)
      held = true
      const answered = statusOf(res)
      const settle = async (): Promise<unknown> => {
        if (answered >= 400) {
          const written = await writtenSince()
          if (written.length) await refresh(written)
          return body
        }
        const failed = await refresh(carts)
        if (failed.length) {
          const refusal = cartPaymentRefreshFailedResponse()
          res.status(refusal.status)
          return refusal.body
        }
        return carts.includes(pathCart) ? withCartReadAgain(req, pathCart, body) : body
      }
      void settle()
        .catch((error: unknown) => {
          // Nothing above is expected to throw. If it does, the cart may be
          // out of step and this request must not read as a success.
          log.error(`[cart-payment] cart ${pathCart}: ${req.method} ${req.path}: ${(error as Error)?.message ?? error}`)
          if (answered >= 400) return body
          const refusal = cartPaymentRefreshFailedResponse()
          res.status(refusal.status)
          return refusal.body
        })
        .then((out) => json(out))
        .catch((error: unknown) => {
          // The answer itself could not be sent (the connection is gone).
          log.error(`[cart-payment] cart ${pathCart}: ${req.method} ${req.path}: the answer could not be sent: ${(error as Error)?.message ?? error}`)
        })
      return res
    }) as MedusaResponse["json"]
    next()
  }
}

/** The fields the completion check reads: a subset of what Mercur's own completion reads (`completeCartFields`). */
const COMPLETION_FIELDS = [
  "id",
  "completed_at",
  "currency_code",
  "total",
  "payment_collection.id",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.amount",
  "payment_collection.payment_sessions.status",
]

/** Put a refused cart's payment side right, so that the buyer's next step works. A failure is logged; the refusal stands. */
async function settleAfterRefusal(scope: MedusaRequest["scope"], cartId: string): Promise<void> {
  try {
    await refreshCartPaymentCollection(scope, cartId)
  } catch (error) {
    log.error(
      `[cart-payment] cart ${cartId}: refused, and its payment side could not be put right, so a session for another amount may still be on it: ${(error as Error)?.message ?? error}`,
      { cart_id: cartId }
    )
  }
}

/**
 * `POST /store/carts/:id/complete`: a cart whose payment session is for an
 * amount that is not the cart's total is refused before Mercur's route runs,
 * so nothing is authorized and no order is created
 * (`judgeCartPaymentAmount`). This is what stops a page rendered before the
 * total changed, a session opened while the total was changing, and any
 * caller of the store API, none of which the storefront's own check can.
 * Mercur's workflow has no hook to make the refusal from, which is why it is
 * made here; everything that completes through Medusa's workflow is refused
 * inside it (`workflows/hooks/validate-cart-payment-amount.ts`).
 *
 * The answer is 409 `cart_payment_amount_mismatch` with the message that is
 * true for the reason (`cartPaymentAmountMismatchResponse`), and the cart's
 * payment side is put right on the way out, so that the message's
 * instruction works: the collection takes the total and the session for the
 * wrong amount is deleted, whichever of the two was behind (its intent is
 * cancelled, releasing a hold the storefront's card confirmation may have
 * placed), and the next session is opened for the cart's total. A captured
 * session is the exception: it is left, and the buyer is sent to support.
 *
 * Closed on doubt: when the cart cannot be read, or the comparison cannot be
 * made, the completion is refused with the same status and code and a
 * message that says only that (nothing is known then about the total having
 * changed). The read is a subset of the one Mercur's completion makes next,
 * so a cart this cannot read is one that could not have completed. A cart
 * that does not exist goes on to the route, which answers for it.
 *
 * Read only as far as Coalition Credits go: it resolves the query and the
 * payment refresh, never the ledger (Posture A).
 */
export async function refuseCompletionOnPaymentAmountMismatch(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const cartId = String(req.params.id ?? "")

  let cart: CartPaymentAmounts | undefined
  try {
    const { data } = await queryOf(req.scope).graph({ entity: "cart", fields: COMPLETION_FIELDS, filters: { id: cartId } })
    cart = data[0] as CartPaymentAmounts | undefined
  } catch (error) {
    const refusal = cartPaymentAmountMismatchResponse("amount_unknown")
    log.error(
      `[cart-payment] cart ${cartId}: completion refused, its payment sessions could not be read to compare them with its total: ${(error as Error)?.message ?? error}`,
      { cart_id: cartId, reason: "amount_unknown" }
    )
    res.status(refusal.status).json(refusal.body)
    return
  }
  if (!cart) return next()

  const verdict = judgeCartPaymentAmount(cart)
  if (verdict.ok) return next()

  const refusal = cartPaymentAmountMismatchResponse(verdict.reason)
  log.error(`[cart-payment] completion refused: ${verdict.detail}; answered ${refusal.status} ${refusal.body.code}, nothing authorized`, {
    cart_id: cartId,
    reason: verdict.reason,
  })
  await settleAfterRefusal(req.scope, cartId)
  res.status(refusal.status).json(refusal.body)
}

/** The cart a completion route was asked to complete. */
type CartOf = (req: MedusaRequest) => unknown

const cartParam =
  (name: string): CartOf =>
  (req) =>
    req.params?.[name]
/** `POST /store/subscriptions` names its cart in the body. */
const cartInBody: CartOf = (req) => (req.body as { cart_id?: unknown } | null | undefined)?.cart_id

/**
 * The store routes that complete a cart through Medusa's
 * `completeCartWorkflow`: when the guard inside that workflow refuses the
 * completion for its session's amount, the cart's payment side is put right
 * before the refusal goes out, as it is in front of Mercur's route.
 *
 * It acts after the handler, on that one answer and no other (the error
 * handler's 409 `cart_payment_amount_mismatch`, `shared/error-sanitizer.ts`).
 * By then the workflow has ended and released the cart, which the refresh
 * needs; and the handler has run its own checks first, so a caller the route
 * would have turned away (`POST /store/subscriptions` answers a cart that is
 * not the caller's with 403) never reaches the refusal and cannot have this
 * delete a session on someone else's cart. The answer itself is passed on
 * unchanged.
 *
 * The cart is read from the request when this middleware runs, not when the
 * answer is sent. The refusal is answered by the application's error
 * handler, and Express hands that handler the request with its own (empty)
 * path parameters, so `req.params.id` is gone by then: read late, the three
 * routes that name the cart in the path settled nothing (measured on
 * Postgres; the body-named cart of `POST /store/subscriptions` was settled).
 */
export function settleCartPaymentAfterRefusedCompletion(cartOf: CartOf) {
  return function settleCartPaymentAfterRefusal(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
    const cartId = cartOf(req)
    const json = res.json.bind(res)
    let held = false
    res.json = ((body: unknown) => {
      const refused =
        !held &&
        statusOf(res) === cartPaymentAmountMismatchResponse().status &&
        (body as { code?: unknown } | null | undefined)?.code === CART_PAYMENT_AMOUNT_MISMATCH &&
        typeof cartId === "string" &&
        cartId.length > 0
      if (!refused) return json(body)
      held = true
      void settleAfterRefusal(req.scope, cartId as string)
        .then(() => json(body))
        .catch((error: unknown) => {
          // The answer itself could not be sent (the connection is gone).
          log.error(`[cart-payment] cart ${String(cartId)}: ${req.method} ${req.path}: the answer could not be sent: ${(error as Error)?.message ?? error}`)
        })
      return res
    }) as MedusaResponse["json"]
    next()
  }
}

/**
 * Spread into `routes` in `src/api/middlewares.ts`.
 *
 * Which writers are here, and which are not:
 *  - Mercur's `POST` and `DELETE /store/carts/:id/shipping-methods` leave the
 *    collection behind on every multi-seller cart (measured, SD-115).
 *  - Mercur's `DELETE /store/carts/:id/line-items/:line_id` removes the
 *    seller's shipping method and runs Medusa's `deleteLineItemsWorkflow`
 *    side by side (`parallelize`), and the refresh inside that workflow reads
 *    the total whenever it gets there. The removal is one statement and won
 *    every time it was measured, but nothing orders the two.
 *  - Mercur's `POST /store/carts/:id/promotions` is not here because it
 *    cannot write. It would be a writer of this kind (it runs Medusa's
 *    `updateCartPromotionsWorkflow` without `force_refresh_payment_collection`),
 *    but it runs that workflow without a container, and the run fails on
 *    "Could not resolve 'query'" before anything changes (measured: 500, the
 *    cart as it was). `integration-tests/http/cart-payment-refresh.spec.ts`
 *    pins that; a Mercur release that repairs the route makes that case fail,
 *    and the route then needs an entry here.
 *  - Medusa's own routes end in the refresh themselves, read in
 *    `@medusajs/core-flows` 2.14.2: add, update and (under Mercur's) delete a
 *    line item, update the cart (addresses, region, promo codes: what the
 *    storefront applies a code with), `DELETE .../promotions` (what it
 *    removes one with), transfer the cart.
 *  - One of Medusa's does not: `POST /store/carts/:id/taxes`
 *    (`updateTaxLinesWorkflow` with `force_tax_calculation`), which writes
 *    the cart's tax lines and answers. In a region with `automatic_taxes` off
 *    that is the only thing that taxes a cart, so it raises the total after
 *    the session was opened (measured with this entry removed: a 15.00 cart
 *    with a card session for 15.00, taxed to 16.50, and its collection left
 *    at 15.00). Nothing of FBM's calls it, but any client may, so it is here. Its write does not change
 *    the cart's shipping methods, so an error answer after a write that went
 *    through is not noticed here and is left to the completion check below;
 *    on this tree the route answers 200 after its write (SD-117).
 *  - FBM's tier and wholesale routes refresh in their handlers
 *    (`lib/cart-payment-refresh.ts`). Its other cart routes (attribution,
 *    channel, group, booking, credits) write metadata only, and its
 *    rental add-to-cart runs Medusa's `addToCartWorkflow`.
 *
 * Which completions are here:
 *  - Mercur's `POST /store/carts/:id/complete` is checked before it runs.
 *  - FBM's four store routes that complete through Medusa's workflow are
 *    refused inside it and settled after it: `complete-tickets`,
 *    `complete-digital`, `POST /store/rentals/:cart_id` and `POST
 *    /store/subscriptions`. The hosted checkout pages
 *    (`/v1/checkout/sessions/:id/page` and Blackout's) answer the same
 *    refusal as they answer any failed checkout and are not settled here;
 *    renewals and Medusa's payment webhook have no caller to answer.
 */
export const cartPaymentMiddlewareRoutes: MiddlewareRoute[] = [
  {
    matcher: "/store/carts/:id/shipping-methods",
    method: "POST",
    middlewares: [refreshCartPaymentAfter(cartInPath)],
  },
  {
    matcher: "/store/carts/:id/shipping-methods",
    method: "DELETE",
    middlewares: [refreshCartPaymentAfter(cartsOfNamedShippingMethods)],
  },
  {
    matcher: "/store/carts/:id/line-items/:line_id",
    method: "DELETE",
    middlewares: [refreshCartPaymentAfter(cartInPath)],
  },
  {
    matcher: "/store/carts/:id/taxes",
    method: "POST",
    middlewares: [refreshCartPaymentAfter(cartInPath)],
  },
  {
    matcher: "/store/carts/:id/complete",
    method: "POST",
    middlewares: [refuseCompletionOnPaymentAmountMismatch],
  },
  {
    matcher: "/store/carts/:id/complete-tickets",
    method: "POST",
    middlewares: [settleCartPaymentAfterRefusedCompletion(cartParam("id"))],
  },
  {
    matcher: "/store/carts/:id/complete-digital",
    method: "POST",
    middlewares: [settleCartPaymentAfterRefusedCompletion(cartParam("id"))],
  },
  {
    matcher: "/store/rentals/:cart_id",
    method: "POST",
    middlewares: [settleCartPaymentAfterRefusedCompletion(cartParam("cart_id"))],
  },
  {
    matcher: "/store/subscriptions",
    method: "POST",
    middlewares: [settleCartPaymentAfterRefusedCompletion(cartInBody)],
  },
]
