import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"

export type ValidateTicketOrderStepInput = {
  items: {
    id: string
    variant_id: string
    metadata: Record<string, unknown>
    quantity: number
    variant?: {
      id: string
      product_id: string
      ticket_product_variant?: {
        purchases?: {
          seat_number: string
          show_date: Date
        }[]
      }
    }
  }[]
  order_id: string
}

// show_date arrives as a string on cart metadata but is stored as a DB `Date`
// on a purchase; normalize both to a YYYY-MM-DD key so the equality check
// actually matches (a raw `Date === string` compare is always false, which
// silently disabled the already-purchased-seat guard and allowed double sales).
const showDateKey = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const s = String(value ?? "")
  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? s : parsed.toISOString().slice(0, 10)
}

export const validateTicketOrderStep = createStep(
  "validate-ticket-order",
  async ({ items, order_id }: ValidateTicketOrderStepInput) => {
    // Check for duplicate seats within the cart
    const seatDateCombinations = new Set<string>()

    for (const item of items) {
      if (item.quantity !== 1) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "You can only purchase one ticket for a seat."
        )
      }

      if (!item.variant || !item.metadata?.seat_number) continue

      if (!item.metadata?.show_date) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Show date is required for seat ${item.metadata?.seat_number} in product ${item.variant.product_id}`
        )
      }

      // A seated item must carry its venue row, or create-ticket-purchases
      // silently skips it — the buyer is charged with no admission record.
      if (!item.metadata?.venue_row_id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Venue row is required for seat ${item.metadata?.seat_number} in product ${item.variant.product_id}`
        )
      }

      const showDate = showDateKey(item.metadata?.show_date)
      // Seat identity is (venue row, seat number, show date). Omitting the row
      // collides same-numbered seats in different rows of the same row type.
      const seatDateKey = `${item.metadata?.venue_row_id}-${item.metadata?.seat_number}-${showDate}`

      // Check if this seat-date combination already exists in the cart
      if (seatDateCombinations.has(seatDateKey)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Duplicate seat ${item.metadata?.seat_number} found for show date ${item.metadata?.show_date} in cart`
        )
      }

      // Add to the set to track this combination
      seatDateCombinations.add(seatDateKey)

      // Check if seat has already been purchased (dates normalized both sides).
      const existingPurchase = item.variant.ticket_product_variant?.purchases?.find(
        (purchase) =>
          purchase?.seat_number === item.metadata?.seat_number &&
          showDateKey(purchase?.show_date) === showDate
      )

      if (existingPurchase) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Seat ${item.metadata?.seat_number} has already been purchased for show date ${item.metadata?.show_date}`
        )
      }
    }

    return new StepResponse({ validated: true }, order_id)
  },
  async (order_id, { container, context }) => {
    if (!order_id) return

    // Awaited so a compensation failure propagates (and the engine can retry)
    // instead of surfacing as an unhandled rejection while reporting success.
    await cancelOrderWorkflow(container).run({
      input: {
        order_id,
      },
      context,
      container,
    })
  }
)