export * from "@custom-types/configuration";
export * from "@custom-types/seller";
export * from "@custom-types/reviews";
export * from "@custom-types/payout";
export * from "@custom-types/marketplace";
export * from "@custom-types/brand";
export * from "@custom-types/commission";
export * from "@custom-types/wishlist";
export * from "@custom-types/attribute";
export * from "@custom-types/order-return-request";
export * from "@custom-types/requests";
export * from "@custom-types/split-order-payment";
export * from "@custom-types/algolia";
export * from "@custom-types/payment-stripe-connect";
export * from "@custom-types/store";
export * from "@custom-types/customer-group";
export * from "@custom-types/product";
export * from "@custom-types/producer";
export * from "@custom-types/venue";
export * from "@custom-types/ticket-product";

// Digital product types are surfaced by the legacy media-management
// route; the API contract isn't fully spec'd yet, so model the minimum
// shape callers compile against.
export enum MediaType {
  PREVIEW = "preview",
  MAIN = "main",
}

export type DigitalProduct = {
  id: string
  name: string
  product_title?: string
  medias?: Array<{ id: string; type: MediaType; url: string }>
  product_variant?: { product_id?: string } | null
}
