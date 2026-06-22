import { Product } from "./product"

type SellerAddress = {
  address_line?: string
  city?: string
  state?: string
  country_code?: string
  postal_code?: string
}

export type SellerProps = SellerAddress & {
  id: string
  name: string
  handle: string
  description: string
  photo: string
  tax_id: string
  created_at: string
  reviews?: any[]
  products?: Product[]
  email?: string
  store_status?: "ACTIVE" | "SUSPENDED" | "INACTIVE"
  verified?: boolean
  phone?: string
  metadata?: SellerMetadata
}

export type SellerScheduling = {
  booking_url?: string
  meeting_platform?: "matrix" | "zoom" | "signal" | "custom" | string
  meeting_url?: string
  meeting_instructions?: string
  ticket_product_handle?: string
}

export type SellerMetadata = {
  scheduling?: SellerScheduling
  [key: string]: unknown
}
