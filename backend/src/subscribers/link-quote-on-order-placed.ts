import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { createLogger } from "../shared/logger"
import { QUOTE_MODULE } from "../modules/quote"
import type QuoteService from "../modules/quote/service"
import { QuoteStatus } from "../modules/quote/pricing"
import { quoteIdFromOrder } from "../modules/quote/order-link"

const log = createLogger("subscribers/link-quote-on-order-placed")

/**
 * Close the quote → order joint.
 *
 * `quote.order_id` was declared "set once that cart becomes an order" and had
 * no writer: the accept route stamped `quote_id` onto the cart and its line
 * items, and nothing ever read the stamp back. A vendor's quote list showed
 * "accepted" forever with no way to tell whether the buyer actually checked
 * out. This is the reader.
 *
 * Idempotent: a duplicate `order.placed` for an already-linked quote is a
 * no-op, and a quote linked to a *different* order is left alone and logged —
 * one quote materializes one cart, so a second order claiming it is a fact
 * worth a human's attention rather than a silent overwrite.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: create an accounts-receivable invoice.
 * A quote-accepted cart still pays through the ordinary checkout — FBM has no
 * pay-later checkout path — so an `ar_invoice` for a placed order would bill
 * the buyer a second time for money Stripe already took. Net-terms invoicing
 * of an order needs a checkout that defers payment first; until that exists,
 * "an accepted quote never becomes an invoice" is correct behaviour, not a
 * missing wire. Recorded here so the next reader does not add it.
 *
 * Never fails order placement.
 */
export default async function linkQuoteOnOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = data.id

  try {
    const query = container.resolve("query") as {
      graph: (args: {
        entity: string
        fields: string[]
        filters: Record<string, unknown>
      }) => Promise<{ data: unknown[] }>
    }
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "metadata", "items.metadata"],
      filters: { id: orderId },
    })
    const order = orders?.[0] as
      | {
          metadata?: Record<string, unknown> | null
          items?: { metadata?: Record<string, unknown> | null }[]
        }
      | undefined
    if (!order) return

    const quoteId = quoteIdFromOrder(order)
    if (!quoteId) return

    const quotes = container.resolve<QuoteService>(QUOTE_MODULE)
    const [quote] = (await quotes.listQuotes({ id: quoteId })) as unknown as {
      id: string
      status: string
      order_id: string | null
    }[]
    if (!quote) {
      log.warn(`[link-quote] order ${orderId} names quote ${quoteId}, which does not exist`)
      return
    }

    if (quote.order_id === orderId) return
    if (quote.order_id) {
      log.warn(
        `[link-quote] quote ${quoteId} is already linked to order ${quote.order_id}; ` +
          `order ${orderId} also claims it — not overwriting`
      )
      return
    }
    if (quote.status !== QuoteStatus.ACCEPTED) {
      log.warn(
        `[link-quote] order ${orderId} names quote ${quoteId} in status ${quote.status}; ` +
          `only an accepted quote can become an order — not linking`
      )
      return
    }

    await quotes.updateQuotes({ id: quoteId, order_id: orderId })
  } catch (err) {
    log.error(`[link-quote-on-order-placed] failed for order ${orderId}:`, err)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
