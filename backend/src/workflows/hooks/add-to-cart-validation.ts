import { addToCartWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { isTicketLine, oneTicketPerSeatError } from "./ticket-line-rules"

// Hook for addToCartWorkflow to validate seat availability. The update route
// has its own (`update-line-item-validation.ts`); the rule both apply is in
// `ticket-line-rules.ts`.
addToCartWorkflow.hooks.validate(
  async ({ input }, { container }) => {
    const items = input.items
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Get the product variant to check if it's a ticket product variant
    const { data: productVariants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "product_id", "ticket_product_variant.id", "ticket_product_variant.purchases.*"],
      filters: {
        id: items.map((item) => item.variant_id).filter(Boolean) as string[]
      }
    })

    // Get existing cart items to check for conflicts
    const { data: [cart] } = await query.graph({
      entity: "cart",
      fields: ["items.*"],
      filters: {
        id: input.cart_id
      }
    }, {
      throwIfKeyNotFound: true
    })

    // Check each item being added to cart
    for (const item of items) {
      const productVariant = productVariants.find((variant) => variant.id === item.variant_id)

      // One ticket per seat holds for ticket lines only. This test used to
      // come first, unscoped, and refused every line not added at quantity 1,
      // whatever the product (`ticket-line-rules.ts`).
      if (isTicketLine(item.metadata, productVariant) && item.quantity !== 1) {
        throw oneTicketPerSeatError()
      }

      if (!productVariant || !item.metadata?.seat_number) continue

      if (!item.metadata?.show_date) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Show date is required for seat ${item.metadata?.seat_number} in product ${productVariant.product_id}`
        )
      }

      // Check if seat has already been purchased
      const existingPurchase = productVariant.ticket_product_variant?.purchases.find(
        (purchase) => purchase?.seat_number === item.metadata?.seat_number 
          && purchase?.show_date === item.metadata?.show_date
      )

      if (existingPurchase) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Seat ${item.metadata?.seat_number} has already been purchased for show date ${item.metadata?.show_date}`
        )
      }

      // Check if seat is already in the cart
      const existingCartItem = cart.items.find(
        (cartItem) => cartItem?.metadata?.seat_number === item.metadata?.seat_number 
          && cartItem?.metadata?.show_date === item.metadata?.show_date
      )

      if (existingCartItem) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Seat ${item.metadata?.seat_number} is already in your cart for show date ${item.metadata?.show_date}`
        )
      }
    }
  }
)
