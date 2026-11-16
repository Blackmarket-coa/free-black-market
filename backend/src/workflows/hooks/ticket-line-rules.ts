import { MedusaError } from "@medusajs/framework/utils"

/**
 * One ticket per seat, as the store's two cart-line routes apply it:
 * `add-to-cart-validation.ts` on `POST /store/carts/:id/line-items` and
 * `update-line-item-validation.ts` on `POST /store/carts/:id/line-items/:line_id`.
 *
 * The rule is about tickets and nothing else. Until 2026-11-16 the add hook
 * tested the quantity before it asked whether the line was a ticket, so it
 * refused every line not added at quantity 1: a crate of tomatoes at 2 answered
 * 400 with this message, and so did every order-cycle add of 2 or more
 * (`storefront/src/lib/data/order-cycles.ts` sends the buyer's quantity with
 * line metadata, which always creates a line). The update route had no hook,
 * so the cart page's + raised a seat line to 2 unrefused.
 *
 * The ticket checkout refuses such a line again before it takes the card
 * (`require-seated-ticket-cart.ts`, `validate-ticket-order.ts`); these hooks
 * say so when the line is made, which is also the only check a cart that goes
 * through Mercur's main checkout gets.
 */

/** The refusal of a ticket line asked for at any quantity but one. */
export const ONE_TICKET_PER_SEAT = "You can only purchase one ticket for a seat."

type LineMetadata = Record<string, unknown> | null | undefined

/** What the rule reads of a variant: whether a ticket variant is linked to it (`links/ticket-product-variant.ts`). */
type MaybeTicketVariant = { ticket_product_variant?: { id?: string | null } | null } | null | undefined

/** A line names a seat when its metadata carries one, as the storefront's seat picker sets it (`TicketPurchasePanel`). */
export function namesSeat(metadata: LineMetadata): boolean {
  return !!metadata?.seat_number
}

/**
 * A ticket line: it names a seat, or its variant is a ticket variant. Every
 * ticket FBM sells is one seat (a ticket purchase always has one), so a ticket
 * line holds exactly one ticket; a line naming no seat on a ticket variant is
 * still a ticket, and stays held to one, as the add route always held it. Any
 * other line holds whatever quantity the buyer asks for.
 */
export function isTicketLine(metadata: LineMetadata, variant: MaybeTicketVariant): boolean {
  return namesSeat(metadata) || !!variant?.ticket_product_variant?.id
}

export function oneTicketPerSeatError(): MedusaError {
  return new MedusaError(MedusaError.Types.INVALID_DATA, ONE_TICKET_PER_SEAT)
}
