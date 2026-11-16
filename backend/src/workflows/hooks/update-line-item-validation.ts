import { updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MathBN, mergeMetadata } from "@medusajs/framework/utils"
import { isTicketLine, namesSeat, oneTicketPerSeatError } from "./ticket-line-rules"

type CartLine = {
  id?: string | null
  variant_id?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * One ticket per seat on `POST /store/carts/:id/line-items/:line_id`
 * (`updateLineItemInCartWorkflow`). The cart page's + and - call it on every
 * line (`UpdateCartItemButton`), and the storefront's `addToCart` calls it to
 * add one more of a variant already in the cart. Before this hook nothing
 * refused a seat line raised to 2 here, however the add route held it.
 *
 * The line is judged as it will stand: at the quantity asked for, with its
 * metadata merged with the update's as Medusa merges it (a key set to "" is
 * removed). A line that is a ticket before or after the update
 * (`isTicketLine`) may be set to 1, or to 0, which removes it, and to nothing
 * else; so dropping the seat in the same request does not free the quantity,
 * and nor does dropping it first, since the variant is still a ticket. A line
 * that is not a ticket is not this rule's business, at any quantity.
 *
 * Medusa runs the hook after it reads the cart and before it reads the
 * variant's price or writes anything, so a refusal answers 400 and leaves the
 * line as it was.
 */
updateLineItemInCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const quantity = input.update?.quantity
  // No quantity leaves the line's as it is, 0 removes the line, 1 is one ticket.
  if (quantity === undefined || quantity === null || MathBN.eq(quantity, 0) || MathBN.eq(quantity, 1)) return

  const lines = ((cart as { items?: Array<CartLine | null> | null } | null | undefined)?.items ?? []) as Array<CartLine | null>
  const line = lines.find((item) => item?.id === input.item_id)
  // Not a line of this cart: Medusa's own step answers 404.
  if (!line) return

  const before = line.metadata
  const after = input.update.metadata ? mergeMetadata(before ?? {}, input.update.metadata) : before

  // A seat is in the metadata; whether the variant is a ticket takes a read,
  // made only when the metadata names no seat either side.
  let variant: { ticket_product_variant?: { id?: string | null } | null } | undefined
  if (!namesSeat(before) && !namesSeat(after) && line.variant_id) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "ticket_product_variant.id"],
      filters: { id: line.variant_id },
    })
    variant = data[0]
  }

  if (isTicketLine(before, variant) || isTicketLine(after, variant)) throw oneTicketPerSeatError()
})
