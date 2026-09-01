import { MedusaError } from "@medusajs/framework/utils"

import { CCR_RESERVATION_METADATA_KEY } from "../../lib/ccr-checkout"

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
 * twice is bolted shut with an error that names exactly what is missing rather
 * than a generic refusal. Deleting this guard is the last step of wiring the
 * tender, not an obstacle to it.
 */
export async function validateCcrReservation(
  args: { input?: { cart_id?: string }; cart?: Record<string, unknown> },
  context: { container?: any }
): Promise<void> {
  const cartId = args?.input?.cart_id
  if (!cartId || !context?.container) return

  let cart: Record<string, unknown> | undefined
  try {
    const query = context.container.resolve("query")
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

  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `This cart has ${reserved} Coalition Credits reserved, and credit tender is not yet wired into payment. ` +
      `Completing it would charge the full total and consume the credits. ` +
      `Release the reservation (DELETE /store/carts/${cartId}/credits) to check out with cash.`
  )
}
