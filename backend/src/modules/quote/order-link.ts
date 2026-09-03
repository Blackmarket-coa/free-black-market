/**
 * Find the quote an order was priced from.
 *
 * Pure. `POST /store/quotes/:id/accept` stamps `quote_id` on the cart's
 * metadata and on every line item it reprices; `completeCartWorkflow` carries
 * cart metadata onto the order. The order-level stamp is authoritative; the
 * line-item stamps are the fallback for an order whose metadata was replaced
 * by some other pre-completion write (several routes spread-and-rewrite cart
 * metadata, and any of them can drop a key another route set).
 *
 * Returns null rather than guessing when the line items disagree: two
 * different quote ids on one order means something upstream went wrong, and
 * linking the order to whichever appeared first would record a fact that is
 * not known to be true.
 */
export const QUOTE_ID_METADATA_KEY = "quote_id"

export type OrderLikeForQuoteLink = {
  metadata?: Record<string, unknown> | null
  items?: { metadata?: Record<string, unknown> | null }[] | null
}

export function quoteIdFromOrder(order: OrderLikeForQuoteLink): string | null {
  const direct = order.metadata?.[QUOTE_ID_METADATA_KEY]
  if (typeof direct === "string" && direct.trim()) return direct.trim()

  const fromItems = new Set<string>()
  for (const item of order.items ?? []) {
    const id = item.metadata?.[QUOTE_ID_METADATA_KEY]
    if (typeof id === "string" && id.trim()) fromItems.add(id.trim())
  }
  if (fromItems.size === 1) return [...fromItems][0]
  return null
}
