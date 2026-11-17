import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { CCR_RESERVATION_METADATA_KEY } from "../../lib/ccr-checkout"
import type { CompleteCartValidateArgs } from "./complete-cart-validate-args"

/**
 * Refuse to complete a cart that still carries a Coalition Credits
 * reservation.
 *
 * Credits are tender, not a discount: applying them must reduce the CASH the
 * buyer is charged while the vendor is still paid in full. Reserving the
 * credits (`lib/ccr-cart-ledger.ts`) is only half of that. The other half —
 * creating the payment collection for the reduced amount — is not built, and
 * until it is, completing a cart with a live reservation would charge the
 * buyer the full total AND consume their credits.
 *
 * So this fails closed. The reservation lifecycle can be exercised end to end
 * (apply, release) without risk, and the one transition that could take money
 * twice is bolted shut. Deleting this guard is the last step of wiring the
 * tender, not an obstacle to it.
 *
 * It runs at both seams that complete carts: `completeCartWorkflow`'s
 * validate hook, and the middleware in front of Mercur's main checkout
 * (`api/middlewares/cart-completion-guards.ts`), whose workflow never calls
 * that hook. The storefront shows the refusal's message to the buyer as it is
 * (`storefront/src/lib/helpers/order-error-formatter.ts`), so it says what
 * happened and what to do in plain words, with no ids and no API paths.
 * Releasing the reservation is `DELETE /store/carts/:id/credits`.
 */
export async function validateCcrReservation(
  args: CompleteCartValidateArgs,
  context: { container?: any }
): Promise<void> {
  // Medusa hands the hook `{ input: { id }, cart }` (see
  // `CompleteCartValidateArgs`). Until SD-54 this read `input.cart_id`,
  // which the hook never carries, so the guard returned here at every
  // checkout and a cart holding a reservation completed at its full total.
  // A cart that has already completed never reaches this guard: the
  // composition skips every guard on a re-run (`complete-cart-guards.ts`).
  const cartId = args?.input?.id
  if (!cartId || !context?.container) return

  let cart: Record<string, unknown> | undefined
  try {
    const query = context.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "metadata"],
      filters: { id: cartId },
    })
    cart = Array.isArray(data) ? data[0] : undefined
  } catch {
    // A cart we cannot read is not a cart we can prove is safe, but neither is
    // it one this guard should block on infrastructure grounds — the other
    // validators in this hook would have failed first.
    return
  }

  const metadata = (cart?.metadata ?? {}) as Record<string, unknown>
  const reserved = Number(metadata[CCR_RESERVATION_METADATA_KEY] ?? 0)
  if (!Number.isFinite(reserved) || reserved <= 0) return

  const credits = `${reserved} Coalition Credit${reserved === 1 ? "" : "s"}`
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `Your cart has ${credits} applied, but paying with Coalition Credits is not available yet, so checking out ` +
      `now would charge the full price and use up the credits as well. Remove the credits from your cart, then ` +
      `place your order again to pay the full price.`
  )
}
