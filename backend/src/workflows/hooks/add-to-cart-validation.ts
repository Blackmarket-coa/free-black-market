import { addToCartWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { assertNewCartLinesKeepOneTicketPerSeat } from "./ticket-line-rules"

// Hook for addToCartWorkflow (`POST /store/carts/:id/line-items`): one ticket
// per seat, and a seat once. The rules are in `ticket-line-rules.ts`, shared
// with the create route's hook (`create-cart-validation.ts`); the update route
// has its own (`update-line-item-validation.ts`). Medusa runs this after it
// reads the cart and before it prices or writes anything.
addToCartWorkflow.hooks.validate(
  async ({ input }, { container }) => {
    const items = input.items
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Each variant's product, and the ticket variant linked to it with its purchases.
    const { data: productVariants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "product_id", "ticket_product_variant.id", "ticket_product_variant.purchases.*"],
      filters: {
        id: items.map((item) => item.variant_id).filter(Boolean) as string[]
      }
    })

    // The cart's lines: the seats already in it, and the lines Medusa adds to.
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: ["items.*"],
      filters: {
        id: input.cart_id
      }
    }, {
      throwIfKeyNotFound: true
    })

    assertNewCartLinesKeepOneTicketPerSeat({
      items,
      variants: productVariants,
      cartLines: cart.items,
      addsToMatchingLines: true,
    })
  }
)
