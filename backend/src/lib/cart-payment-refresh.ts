import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  deletePaymentSessionsWorkflow,
  refreshCartItemsWorkflow,
  refreshPaymentCollectionForCartWorkflow,
} from "@medusajs/medusa/core-flows"
import { type CartPaymentAmounts, paymentsLeftWithoutSession, sessionsNotForCartTotal } from "./cart-payment-amount"

/**
 * What a writer of a cart's total runs afterwards when it is not one of
 * Medusa's own cart workflows, and what a refused completion runs so that the
 * buyer's next step works (SD-115; the decision and the reasoning are in
 * `lib/cart-payment-amount.ts`). Both throw when a step fails: a caller must
 * not report success on a cart whose payment was left behind.
 *
 * Each has three parts, because Medusa's refresh alone is not enough:
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
 *  3. Deleting a session that was authorized leaves its Payment row on the
 *     collection, live, for an intent that is cancelled, and the next capture
 *     takes it instead of the payment the buyer then made
 *     (`paymentsLeftWithoutSession` says how, and what was measured). So every
 *     payment left without its session is cancelled and taken off the
 *     collection (`retireOrphanedPayments`). This part runs after the other
 *     two whether or not they worked: it is what a session deleted part way
 *     through a failed refresh leaves behind, and it touches nothing else.
 */

type QueryLike = {
  graph: (args: { entity: string; fields: string[]; filters: Record<string, unknown> }) => Promise<{ data: unknown[] }>
}

/**
 * The payment module as far as part 3 uses it. `softDeletePayments` is the
 * method Medusa's service factory generates for the Payment model (the
 * module's published interface leaves it out); the integration spec runs it
 * on Postgres.
 */
type PaymentModuleLike = {
  cancelPayment: (id: string) => Promise<unknown>
  softDeletePayments: (ids: string[]) => Promise<unknown>
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
  // The column, not `payments.payment_session.id`: a nested read of the
  // session leaves out a payment whose session is gone, which is exactly the
  // payment part 3 looks for (`liveSessionIds` in
  // `workflows/subscription/steps/subscription-order-settlement.ts`).
  "payment_collection.payments.id",
  "payment_collection.payments.payment_session_id",
  "payment_collection.payments.captured_at",
  "payment_collection.payments.canceled_at",
]

async function readCart(scope: MedusaContainer, cartId: string): Promise<CartPaymentAmounts | undefined> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
  const { data } = await query.graph({ entity: "cart", fields: CART_FIELDS, filters: { id: cartId } })
  return data[0] as CartPaymentAmounts | undefined
}

async function staleSessions(scope: MedusaContainer, cartId: string): Promise<string[]> {
  const cart = await readCart(scope, cartId)
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
 * Part 3: cancel each payment on the cart's collection that captured nothing
 * and whose session is gone (`paymentsLeftWithoutSession`), then soft-delete
 * it, so that no capture can take it.
 *
 * Cancelling marks the payment's `canceled_at` and cancels its intent with
 * the provider. The intent was already cancelled when its session was
 * deleted, and Medusa's Stripe provider answers a second cancel of a
 * cancelled intent with that intent rather than an error. One Medusa already
 * marked cancelled is only soft-deleted. Cancelling alone is what FBM's own
 * capture selection needs (it passes over a cancelled payment whose session
 * is gone); Mercur's capture takes the collection's first payment whatever
 * its state, and the payment module refuses to capture a cancelled one, so
 * the payment is also taken off the collection. Soft-deleted, not deleted:
 * the row stays in the database with its `canceled_at` and its intent, and
 * the payment and capture reads (Mercur's, FBM's, the admin's) no longer
 * list it. Medusa soft-deletes a collection's payments with the collection,
 * so a soft-deleted payment is a state its own reads already handle.
 *
 * A payment whose intent the provider will not cancel (an intent that was
 * captured at Stripe without Medusa recording it: money was taken) is left
 * where it is, and this throws, so the caller does not report the cart as
 * settled.
 *
 * Also run on its own in front of Mercur's completion
 * (`api/middlewares/cart-payment-refresh.ts`), for a payment that one of
 * Medusa's own cart workflows orphaned: their refresh deletes an authorized
 * session too, and nothing of FBM's runs after it.
 */
export async function retireOrphanedPayments(scope: MedusaContainer, cartId: string): Promise<void> {
  const cart = await readCart(scope, cartId)
  const orphans = cart ? paymentsLeftWithoutSession(cart) : []
  if (!orphans.length) return
  const payments = scope.resolve(Modules.PAYMENT) as unknown as PaymentModuleLike
  const failed: string[] = []
  for (const orphan of orphans) {
    try {
      if (!orphan.canceled) await payments.cancelPayment(orphan.id)
      await payments.softDeletePayments([orphan.id])
    } catch (error) {
      failed.push(`${orphan.id}: ${(error as Error)?.message ?? error}`)
    }
  }
  if (failed.length) {
    throw new Error(
      `cart ${cartId}: ${failed.length} payment(s) left without their session could not be cancelled and taken off the collection: ${failed.join("; ")}`
    )
  }
}

/** Parts 1 and 2 (`settle`), then part 3 whatever they did; the first failure is what the caller gets. */
async function settleThenRetire(scope: MedusaContainer, cartId: string, settle: () => Promise<void>): Promise<void> {
  let failure: { error: unknown } | null = null
  try {
    await settle()
  } catch (error) {
    failure = { error }
  }
  try {
    await retireOrphanedPayments(scope, cartId)
  } catch (error) {
    failure ??= { error }
  }
  if (failure) throw failure.error
}

/**
 * Bring the cart's payment side to the cart's total: Medusa's
 * `refreshPaymentCollectionForCartWorkflow`, the last step of each of its own
 * cart workflows (when the collection's amount is not the total it takes the
 * total and every session on it is deleted; when they agree, or the cart has
 * no collection yet, it changes nothing), then the sessions it left that are
 * not for the total, then the payments left without their session.
 *
 * For a write that changed which shipping methods the cart has and nothing
 * about its line items (Mercur's shipping-method routes,
 * `api/middlewares/cart-payment-refresh.ts`), and after a completion refused
 * for its session's amount.
 */
export async function refreshCartPaymentCollection(scope: MedusaContainer, cartId: string): Promise<void> {
  await settleThenRetire(scope, cartId, async () => {
    await refreshPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: cartId } })
    await deleteSessionsNotForCartTotal(scope, cartId)
  })
}

/**
 * After a line item's price was written through the cart module (the tier
 * and wholesale routes): Medusa's `refreshCartItemsWorkflow`, which is what
 * its own line-item workflows end in, then the sessions it left that are not
 * for the total, then the payments left without their session.
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
  await settleThenRetire(scope, cartId, async () => {
    await refreshCartItemsWorkflow(scope).run({ input: { cart_id: cartId } })
    await deleteSessionsNotForCartTotal(scope, cartId)
  })
}
