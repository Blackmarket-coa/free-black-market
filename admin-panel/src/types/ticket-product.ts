/**
 * Ticket-product type for the admin ticketing screens. Shape mirrors
 * what src/routes/ticket-products/page.tsx and related components read
 * from the `/admin/ticket-products` endpoint. Replace with generated
 * API types once the backend contract is finalised.
 */
export interface TicketProduct {
  id: string
  product_id: string
  product: {
    id: string
    title: string
    handle?: string
  }
  venue_id: string
  venue: {
    id: string
    name: string
  }
  dates: string[]
  created_at?: string
  updated_at?: string
}
