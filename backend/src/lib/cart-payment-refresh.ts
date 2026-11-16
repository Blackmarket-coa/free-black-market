import type { MedusaContainer } from "@medusajs/framework/types"
import { refreshCartItemsWorkflow, refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"

/**
 * What a writer of a cart's total runs afterwards when it is not one of
 * Medusa's own cart workflows (SD-115; the decision and the reasoning are in
 * `lib/cart-payment-amount.ts`). Both throw when the workflow fails: a caller
 * must not report success on a cart whose payment was left behind.
 */

/**
 * Bring the cart's payment collection to the cart's total: Medusa's
 * `refreshPaymentCollectionForCartWorkflow`, the last step of each of its own
 * cart workflows. When the collection's amount is not the total it takes the
 * total and every session opened for the old amount is deleted (for Stripe,
 * the intent is cancelled); when they agree, or the cart has no collection
 * yet, it changes nothing.
 *
 * For a write that changed which shipping methods the cart has and nothing
 * about its line items: Mercur's shipping-method routes
 * (`api/middlewares/cart-payment-refresh.ts`).
 */
export async function refreshCartPaymentCollection(scope: MedusaContainer, cartId: string): Promise<void> {
  await refreshPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: cartId } })
}

/**
 * After a line item's price was written through the cart module (the tier
 * and wholesale routes): Medusa's `refreshCartItemsWorkflow`, which is what
 * its own line-item workflows end in.
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
}
