import { updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import type { BigNumberInput } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, isDefined, mergeMetadata } from "@medusajs/framework/utils"
import {
  assertNewCartLinesKeepOneTicketPerSeat,
  isTicketLine,
  namesSeat,
  oneTicketPerSeatError,
  type TicketRuleVariant,
} from "./ticket-line-rules"

type CartLine = {
  id?: string | null
  variant_id?: string | null
  quantity?: BigNumberInput | null
  metadata?: Record<string, unknown> | null
}
type LineMetadata = Record<string, unknown> | null | undefined

/** The keys that say which seat a line holds, as the storefront's seat picker writes them (`TicketPurchasePanel`). */
const SEAT_KEYS = ["venue_row_id", "seat_number", "show_date"] as const

/** The update leaves the line naming a seat, and not the one it named before. */
function movesSeat(before: LineMetadata, after: LineMetadata): boolean {
  return namesSeat(after) && SEAT_KEYS.some((key) => after?.[key] !== before?.[key])
}

/**
 * One ticket per seat on `POST /store/carts/:id/line-items/:line_id`
 * (`updateLineItemInCartWorkflow`). The cart page's + and - call it on every
 * line (`UpdateCartItemButton`), and the storefront's `addToCart` calls it to
 * add one more of a variant already in the cart. Before this hook nothing
 * refused a seat line raised to 2 here, however the add route held it, nor a
 * line moved onto a seat already in the cart.
 *
 * The line is judged as it will stand: at the quantity asked for, with its
 * metadata merged with the update's as Medusa merges it (a key set to "" is
 * removed). Two rules, both from `ticket-line-rules.ts`:
 *
 * - A line that is a ticket before or after the update (`isTicketLine`) may be
 *   set to 1, or to 0, which removes it, and to nothing else; so dropping the
 *   seat in the same request does not free the quantity, and nor does dropping
 *   it first, since the variant is still a ticket. A line that is not a ticket
 *   is not this rule's business, at any quantity. Lowering a line's quantity,
 *   and changing nothing else, never adds a ticket, so it is let through: a
 *   ticket line left above one by an earlier cart (one built before these
 *   hooks) can be stepped down with the cart page's -, which sends the
 *   quantity alone.
 * - A line the update gives another seat (`movesSeat`) is judged as the add
 *   judges a new seat line, against the cart's other lines: one ticket, a show
 *   date, and a seat no other line names.
 *
 * Medusa runs the hook after it reads the cart and before it reads the
 * variant's price or writes anything, so a refusal answers 400 and leaves the
 * line as it was.
 */
updateLineItemInCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const quantity = input.update?.quantity
  const setsQuantity = isDefined(quantity) && quantity !== null
  // 0 removes the line: nothing of it is left to judge.
  if (setsQuantity && MathBN.eq(quantity, 0)) return

  const lines = ((cart as { items?: Array<CartLine | null> | null } | null | undefined)?.items ?? []) as Array<CartLine | null>
  const line = lines.find((item) => item?.id === input.item_id)
  // Not a line of this cart: Medusa's own step answers 404.
  if (!line) return

  const before = line.metadata
  const after = input.update.metadata ? mergeMetadata(before ?? {}, input.update.metadata) : before
  const query = () => container.resolve(ContainerRegistrationKeys.QUERY)

  const stepsDown =
    setsQuantity && !input.update.metadata && isDefined(line.quantity) && line.quantity !== null && MathBN.lt(quantity, line.quantity)
  if (setsQuantity && !MathBN.eq(quantity, 1) && !stepsDown) {
    // A seat is in the metadata; whether the variant is a ticket takes a read,
    // made only when the metadata names no seat either side.
    let variant: { ticket_product_variant?: { id?: string | null } | null } | undefined
    if (!namesSeat(before) && !namesSeat(after) && line.variant_id) {
      const { data } = await query().graph({
        entity: "product_variant",
        fields: ["id", "ticket_product_variant.id"],
        filters: { id: line.variant_id },
      })
      variant = data[0]
    }

    if (isTicketLine(before, variant) || isTicketLine(after, variant)) throw oneTicketPerSeatError()
  }

  if (movesSeat(before, after)) {
    let variants: TicketRuleVariant[] = []
    if (line.variant_id) {
      const { data } = await query().graph({
        entity: "product_variant",
        fields: ["id", "product_id", "ticket_product_variant.id", "ticket_product_variant.purchases.*"],
        filters: { id: line.variant_id },
      })
      variants = data
    }

    assertNewCartLinesKeepOneTicketPerSeat({
      items: [{ variant_id: line.variant_id, quantity: setsQuantity ? quantity : (line.quantity ?? 1), metadata: after }],
      variants,
      cartLines: lines.filter((other) => other !== line),
      addsToMatchingLines: false,
    })
  }
})
