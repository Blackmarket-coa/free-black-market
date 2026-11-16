import type { BigNumberInput } from "@medusajs/framework/types"
import { MathBN, MedusaError, deepEqualObj, isPresent } from "@medusajs/framework/utils"

/**
 * One ticket per seat, on each store route that writes a cart line, through
 * the validate hook FBM registers on that route's workflow:
 *
 * - `POST /store/carts` with `items` (`createCartWorkflow`): `create-cart-validation.ts`;
 * - `POST /store/carts/:id/line-items` (`addToCartWorkflow`): `add-to-cart-validation.ts`;
 * - `POST /store/carts/:id/line-items/:line_id` (`updateLineItemInCartWorkflow`):
 *   `update-line-item-validation.ts`.
 *
 * No other store route sets a line's quantity or seat: `POST /store/carts/:id`
 * takes no items, Mercur 1.5.0 overrides only DELETE on the line route, and
 * FBM's own cart routes either run `addToCartWorkflow` (rentals) or rewrite a
 * line's price and pricing metadata (wholesale, tier). The quote,
 * subscription-renewal and Blackout checkout routes build their carts with
 * `createCartWorkflow`, so the create hook judges their lines too.
 *
 * The rule is about tickets and nothing else. Until 2026-11-16 the add hook
 * tested the quantity before it asked whether the line was a ticket, so it
 * refused every line not added at quantity 1: a crate of tomatoes at 2 answered
 * 400 with this message, and so did every order-cycle add of 2 or more
 * (`storefront/src/lib/data/order-cycles.ts` sends the buyer's quantity with
 * line metadata, which always goes through the add route). The update and
 * create routes had no hook: the cart page's + raised a seat line to 2, the
 * update route moved a line onto a seat another line held, and a cart created
 * with items held a seat at any quantity, or the same seat twice. And the add
 * judged only the quantity asked for, so a line naming no seat on a ticket
 * variant, added twice, became one line of two (Medusa adds an equal variant
 * and metadata to the existing line).
 *
 * The ticket checkout refuses such a line again before it takes the card
 * (`require-seated-ticket-cart.ts`, `validate-ticket-order.ts`). Mercur's
 * `POST /store/carts/:id/complete` has no ticket check at all, so for a cart
 * completed there these hooks are the only one.
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

/**
 * What the seat rules read of a variant: its product, and the ticket variant
 * linked to it with that variant's purchases. A hook reads it with
 * `query.graph` on `product_variant`, asking for
 * `["id", "product_id", "ticket_product_variant.id", "ticket_product_variant.purchases.*"]`.
 */
export type TicketRuleVariant = {
  id: string
  product_id?: string | null
  ticket_product_variant?: {
    id?: string | null
    purchases?: Array<{ seat_number?: string | null; show_date?: unknown } | null> | null
  } | null
}

/** A line a request asks to write into a cart. */
export type NewCartLine = {
  variant_id?: string | null
  quantity: BigNumberInput
  metadata?: Record<string, unknown> | null
}

/** A line already in the cart, as `query.graph` reads `cart.items.*`. */
export type CartLine = {
  variant_id?: string | null
  metadata?: Record<string, unknown> | null
} | null

/**
 * The line already in the cart that Medusa's add puts `item` into instead of
 * creating a new one. Core-flows 2.14.2 `getLineItemActionsStep` adds a new
 * item's quantity to an existing line on the same variant whose metadata
 * matches: both empty (`isPresent`) or equal (`deepEqualObj`), the new side
 * read as `prepareLineItemData` writes it, `item.metadata ?? {}`. It looks only
 * at lines already in the cart, never at another item of the same request.
 *
 * An item that carries its own unit price is put only into a line at that
 * price; no store route sends one, and this judges such an item as if it did
 * not, which errs on refusing a ticket line, never on letting one grow.
 */
export function lineTheAddPutsItemInto<L extends CartLine>(cartLines: readonly L[], item: NewCartLine): L | undefined {
  const metadata = item.metadata ?? {}
  return cartLines.find(
    (line) =>
      !!line &&
      line.variant_id === item.variant_id &&
      ((!isPresent(line.metadata) && !isPresent(metadata)) || deepEqualObj(line.metadata, metadata))
  )
}

/**
 * The rules every new line passes, and every line given another seat: on the
 * add (`cartLines` the cart's lines, `addsToMatchingLines` true), the create
 * (`cartLines` empty, `addsToMatchingLines` false, since a new cart has no
 * line to add to) and the update when it changes a line's seat (`items` the
 * line as it will stand, `cartLines` the cart's other lines,
 * `addsToMatchingLines` false). The lines are judged one at a time, in order,
 * each refusal in the add route's own words:
 *
 * 1. A ticket line (`isTicketLine`) holds one ticket.
 * 2. A line naming a seat, on a variant that was found, names its show date.
 * 3. That seat has not been purchased for that date. The purchase's
 *    `show_date` is compared with `===` to the line's, as the add hook always
 *    compared it; `query.graph` returns it as a `Date` and the line holds a
 *    string, so this never matches (measured on Postgres, 2026-11-16; open).
 *    `validate-ticket-order.ts` normalises both sides before it compares.
 * 4. No line already in the cart, nor an earlier line of the same request,
 *    names the same seat number and show date.
 * 5. On the add, a ticket line does not go into a line already in the cart
 *    (`lineTheAddPutsItemInto`), which would make one line of two tickets. A
 *    line naming no seat on a ticket variant, added twice, is the case rule 4
 *    cannot see. Checked last, so a seat already in the cart is refused in
 *    rule 4's words.
 *
 * Rules 2 to 4 key a seat on its number and show date, as the add hook always
 * has; the ticket checkout keys it on its venue row as well.
 */
export function assertNewCartLinesKeepOneTicketPerSeat({
  items,
  variants,
  cartLines,
  addsToMatchingLines,
}: {
  items: readonly NewCartLine[]
  variants: readonly TicketRuleVariant[]
  cartLines: readonly CartLine[]
  addsToMatchingLines: boolean
}): void {
  const seatsTaken: CartLine[] = [...cartLines]

  for (const item of items) {
    const variant = variants.find((candidate) => candidate.id === item.variant_id)
    const metadata = item.metadata
    const ticket = isTicketLine(metadata, variant)

    if (ticket && !MathBN.eq(item.quantity, 1)) throw oneTicketPerSeatError()

    if (variant && namesSeat(metadata)) {
      const seat = metadata?.seat_number
      const showDate = metadata?.show_date

      if (!showDate) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Show date is required for seat ${seat} in product ${variant.product_id}`
        )
      }

      const purchased = variant.ticket_product_variant?.purchases?.find(
        (purchase) => purchase?.seat_number === seat && purchase?.show_date === showDate
      )
      if (purchased) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Seat ${seat} has already been purchased for show date ${showDate}`
        )
      }

      const inCart = seatsTaken.find(
        (line) => line?.metadata?.seat_number === seat && line?.metadata?.show_date === showDate
      )
      if (inCart) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Seat ${seat} is already in your cart for show date ${showDate}`
        )
      }
    }

    if (ticket && addsToMatchingLines && lineTheAddPutsItemInto(cartLines, item)) throw oneTicketPerSeatError()

    seatsTaken.push({ variant_id: item.variant_id, metadata })
  }
}
