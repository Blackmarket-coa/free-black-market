import { createCartWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { assertNewCartLinesKeepOneTicketPerSeat, type TicketRuleVariant } from "./ticket-line-rules"

/**
 * One ticket per seat on `POST /store/carts` with `items`
 * (`createCartWorkflow`), with the add route's rules
 * (`ticket-line-rules.ts`): a ticket line holds one ticket, a seat names its
 * show date, and no seat is named twice in the request. Before this hook a
 * cart created with items skipped every ticket rule: a seat line at 2, and the
 * same seat on two lines, both answered 200 (measured on Postgres, 2026-11-16).
 *
 * Medusa 2.14.2 runs this hook after it has priced the items and confirmed
 * inventory, and before it creates the cart, so a refusal answers 400 and
 * leaves no cart. FBM's quote acceptance, subscription renewal and Blackout
 * checkout build carts with this workflow too, and their lines are judged the
 * same way. A cart created with no items, as the storefront creates one, costs
 * no read.
 */
createCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  const items = input.items ?? []
  if (!items.length) return

  const variantIds = items.map((item) => item.variant_id).filter(Boolean) as string[]
  let variants: TicketRuleVariant[] = []
  if (variantIds.length) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "product_id", "ticket_product_variant.id", "ticket_product_variant.purchases.*"],
      filters: { id: variantIds },
    })
    variants = data
  }

  assertNewCartLinesKeepOneTicketPerSeat({ items, variants, cartLines: [], addsToMatchingLines: false })
})
