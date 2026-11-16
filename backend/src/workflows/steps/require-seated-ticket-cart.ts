import { createStep, StepResponse, type StepExecutionContext } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { featureFlagState } from "../../shared/feature-flags"

/** A cart line as the ticket checkout reads it: enough to tell whether it is one seat. */
export type TicketCartLine = {
  id?: string | null
  quantity?: number | null
  metadata?: Record<string, unknown> | null
  variant?: { ticket_product_variant?: { id?: string | null } | null } | null
}

/** The seat a line must name, in the order the refusal lists what is missing. */
const SEAT_FIELDS = ["venue_row_id", "seat_number", "show_date"] as const

/**
 * Why `line` cannot be sold as one seat, or null when it can: its variant is
 * a ticket variant (`ticket_product_variant`), it names its venue row, seat
 * number and show date, and it asks for one.
 *
 * These are exactly the lines `createTicketPurchasesStep` turns into a ticket
 * purchase (it skips a line with no ticket variant, venue row or seat number)
 * and `validateTicketOrderStep` checks (it requires the show date, and one of
 * each seat). Any other line is paid for and sells nothing.
 */
export function unseatedTicketLineReason(line: TicketCartLine): string | null {
  if (!line.variant?.ticket_product_variant?.id) return "is not a ticket"
  const missing = SEAT_FIELDS.filter((field) => !line.metadata?.[field])
  if (missing.length) return `names no ${missing.join(", ")}`
  if (line.quantity !== 1) return `asks for ${line.quantity ?? "no"} of one seat`
  return null
}

/** The lines of `lines` that are not one seat each, with why. */
export function unseatedTicketLines(lines: Array<TicketCartLine | null | undefined>): Array<{ id: string; reason: string }> {
  return lines.flatMap((line, i) => {
    const reason = unseatedTicketLineReason(line ?? {})
    return reason ? [{ id: line?.id ?? `#${i + 1}`, reason }] : []
  })
}

/** The refusal of a settling ticket checkout's cart (or order) that holds such lines. */
export function unseatedTicketCartError(problems: Array<{ id: string; reason: string }>): MedusaError {
  return new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `A ticket checkout sells one seat per line and nothing else, and this cart cannot be settled: ${problems
      .map((p) => `line ${p.id} ${p.reason}`)
      .join("; ")}.`
  )
}

export const requireSeatedTicketCartStepId = "require-seated-ticket-cart"

/**
 * SD-48 (i) review (`FF_TICKET_ORDER_SETTLEMENT_V1`): a settling ticket
 * checkout takes the card only for seats it sells.
 *
 * The storefront sends to `POST /store/carts/:id/complete-tickets` every cart
 * whose lines all carry `metadata.show_date`, and line metadata is set by the
 * store client. Before this step, with the flag on, a line that was not a
 * ticket, or a ticket line naming no seat, was authorized, captured and
 * credited to the seller while the seat check skipped it
 * (`validateTicketOrderStep`: a line with no seat number is passed over) and
 * no ticket purchase was made for it (`createTicketPurchasesStep` skips it).
 * Seen on a real database in review: a ticket line carrying only
 * `{ show_date }` was captured (5), linked to its seller, and sold nothing;
 * a plain single-seller product through the same route was captured too.
 *
 * So, with the flag on, every line of the cart must be one seat
 * (`unseatedTicketLineReason`), or the checkout is refused here (the store
 * route answers 400). On a first checkout this runs before Medusa authorizes
 * the payment session, so nothing is authorized or captured. It runs on a
 * replay too — before the link and the capture, whatever ticket purchases
 * the order already has — so an order completed some other way (Medusa's own
 * completion, its Stripe webhook, this checkout with the flag off) is never
 * captured here for lines that sold nothing; nothing on a replay refunds or
 * cancels, so that order is left as it was for an operator.
 * `validateTicketOrderStep` refuses the same lines again when settling
 * (`seats_only`), as a second line of defence.
 *
 * Flag off, returns before any read, and the checkout passes such lines
 * over, as it always has.
 */
export const requireSeatedTicketCartStep = createStep(
  requireSeatedTicketCartStepId,
  async (input: { cart_id: string }, { container }: StepExecutionContext) => {
    if (!featureFlagState.isEnabled("TICKET_ORDER_SETTLEMENT_V1")) return new StepResponse({ checked: false })
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
      graph: (q: Record<string, unknown>) => Promise<{ data: unknown[] }>
    }
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "items.id", "items.quantity", "items.metadata", "items.variant.ticket_product_variant.id"],
      filters: { id: input.cart_id },
    })
    const cart = (data as Array<{ items?: Array<TicketCartLine | null> | null } | null>)[0]
    const problems = unseatedTicketLines(cart?.items ?? [])
    if (problems.length) throw unseatedTicketCartError(problems)
    return new StepResponse({ checked: true })
  }
)
