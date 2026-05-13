/**
 * Venue + seating-chart types for the ticket-sales admin screens.
 *
 * These were lost during a vendor-panel rebase and the typecheck depends
 * on their shape; values are inferred from the routes/components that
 * consume them (src/routes/venues, src/routes/ticket-products,
 * src/components/seat-chart, src/components/create-ticket-product-modal,
 * src/components/pricing-step). When the backend `/admin/venues`
 * contract is formalised, these types should be replaced with the
 * generated types from the API.
 */
export enum RowType {
  VIP = "vip",
  PREMIUM = "premium",
  BALCONY = "balcony",
  STANDARD = "standard",
}

export interface VenueRow {
  id?: string
  row_number: string
  row_type: RowType
  seat_count: number
}

export interface Venue {
  id: string
  name: string
  address?: string
  rows: VenueRow[]
  created_at?: string
  updated_at?: string
}

export interface CreateVenueRequest {
  name: string
  address?: string
  rows: Array<Omit<VenueRow, "id">>
}
