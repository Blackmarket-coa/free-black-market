import { getTicketAvailability } from "@/lib/data/tickets"
import { HttpTypes } from "@medusajs/types"
import { TicketPurchasePanel } from "./TicketPurchasePanel"

/**
 * Server shell for the event ticket-purchase panel (mounted in the product
 * detail page's `data-listing-slot="event"` slot). Fetches show-date
 * availability for the product's linked ticket product and hands it to the
 * interactive client panel. Renders nothing when the product has no ticket
 * data (e.g. an event listing created without the ticket-booking module), so
 * the detail page degrades gracefully.
 */
export const TicketPurchase = async ({
  product,
  locale,
}: {
  product: HttpTypes.StoreProduct
  locale: string
}) => {
  const availability = await getTicketAvailability(product.id)

  if (!availability || !availability.dates.length) return null

  return (
    <TicketPurchasePanel
      productId={product.id}
      productTitle={product.title}
      variants={product.variants || []}
      locale={locale}
      venueName={availability.venue_name}
      dates={availability.dates}
    />
  )
}
