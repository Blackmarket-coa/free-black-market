import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  deletePaymentSessionsWorkflow,
  refreshCartItemsWorkflow,
  refreshPaymentCollectionForCartWorkflow,
} from "@medusajs/medusa/core-flows"
import { type CartPaymentAmounts, sessionsNotForCartTotal } from "./cart-payment-amount"

/**
 * What a writer of a cart's total runs afterwards when it is not one of
 * Medusa's own cart workflows, and what a refused completion runs so that the
 * buyer's next step works (SD-115; the decision and the reasoning are in
 * `lib/cart-payment-amount.ts`). Both throw when a step fails: a caller must
 * not report success on a cart whose payment was left behind.
 *
 * Each has two halves, because Medusa's refresh alone is not enough:
 *
 *  1. Medusa's refresh brings the payment collection to the cart's total, and
 *     deletes the collection's sessions when it had to change the amount.
 *  2. When the collection already agrees with the total it does nothing, and
 *     a session can still be for another amount: one opened while a write
 *     that changed the total was on its way reads the collection before that
 *     write's refresh and is stored after it. Measured through the real
 *     routes with the session insert held until the delivery change had
 *     answered: total 19, collection 19, pending session 17, and a refusal
 *     at completion that left it there for good. So after the refresh the
 *     sessions that are not for the total are deleted
 *     (`sessionsNotForCartTotal`), whichever half was the stale one.
 */

type QueryLike = {
  graph: (args: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
}

const CART_FIELDS = [
  "id",
  "completed_at",
  "currency_code",
  "total",
  "payment_collection.id",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.amount",
  "payment_collection.payment_sessions.status",
]

async function staleSessions(scope: MedusaContainer, cartId: string): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
  const { data } = await query.graph({ entity: "cart", fields: CART_FIELDS, filters: { id: cartId } })
  const cart = data[0] as CartPaymentAmounts | undefined
  return cart ? sessionsNotForCartTotal(cart) : []
}

/**
 * Delete the cart's sessions that are not for its total (never a captured
 * one: see `sessionsNotForCartTotal`). Deleting a session cancels its intent
 * with the provider, which releases a hold the storefront's card confirmation
 * may have placed.
 *
 * Throws when one is still there afterwards. Medusa's workflow fails when a
 * session it was asked to delete is not deleted, which is also what happens
 * when another request deleted it first, so on a failure the cart is read
 * once more and only a session still standing for another amount is an error.
 */
async function deleteSessionsNotForCartTotal(scope: MedusaContainer, cartId: string): Promise<void> {
  const ids = await staleSessions(scope, cartId)
  if (!ids.length) return
  try {
    await deletePaymentSessionsWorkflow(scope).run({ input: { ids } })
  } catch (error) {
    if ((await staleSessions(scope, cartId)).length) throw error
  }
}

/**
 * Bring the cart's payment side to the cart's total: Medusa's
 * `refreshPaymentCollectionForCartWorkflow`, the last step of each of its own
 * cart workflows (when the collection's amount is not the total it takes the
 * total and every session on it is deleted; when they agree, or the cart has
 * no collection yet, it changes nothing), and then the sessions it left that
 * are not for the total.
 *
 * For a write that changed which shipping methods the cart has and nothing
 * about its line items (Mercur's shipping-method routes,
 * `api/middlewares/cart-payment-refresh.ts`), and after a completion refused
 * for its session's amount.
 */
export async function refreshCartPaymentCollection(scope: MedusaContainer, cartId: string): Promise<void> {
  await refreshPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: cartId } })
  await deleteSessionsNotForCartTotal(scope, cartId)
}

/**
 * After a line item's price was written through the cart module (the tier
 * and wholesale routes): Medusa's `refreshCartItemsWorkflow`, which is what
 * its own line-item workflows end in, and then the sessions it left that are
 * not for the total.
 *
 * The payment collection alone is not enough there. A promotion's adjustment
 * is stored as an amount, computed from the price the line had when the
 * promotion was last applied, so after a reprice the cart's total is itself
 * wrong until the promotions are computed again. Measured on Postgres, in a
 * probe that was not kept: a 20.00 line with a 10% promotion and a 10% tax
 * line, repriced to 13.00 through the cart module, kept its 2.00 adjustment
 * and totalled 12.10; refreshing only the payment collection then set the
 * collection to 12.10; this workflow recomputed the adjustment to 1.30 and
 * both the total and the collection to 12.87. Tax lines hold a rate and
 * follow the price on read, so they are not what goes stale.
 * `integration-tests/http/cart-payment-refresh.spec.ts` pins the same through
 * the tier route (a 10.00 line with a 10% promotion, repriced to 6.50, ends
 * with a 0.65 adjustment) and fails when only the payment collection is
 * refreshed.
 *
 * Without `force_refresh` the workflow does not fetch prices again, so the
 * custom price just written stands. It also runs Medusa's shipping-method
 * refresh, as every line-item write through Medusa's routes does.
 */
export async function refreshCartAfterReprice(scope: MedusaContainer, cartId: string): Promise<void> {
  await refreshCartItemsWorkflow(scope).run({ input: { cart_id: cartId } })
  await deleteSessionsNotForCartTotal(scope, cartId)
}
