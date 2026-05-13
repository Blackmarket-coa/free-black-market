export * from "./configuration";
export * from "./seller";
export * from "./reviews";
export * from "./payout";
export * from "./marketplace";
export * from "./brand";
export * from "./commission";
export * from "./wishlist";
export * from "./attribute";
export * from "./order-return-request";
export * from "./requests";
export * from "./split-order-payment";
export * from "./algolia";
export * from "./payment-stripe-connect";
export * from "./store";
export * from "./customer-group";
export * from "./product";
export * from "./producer";
export * from "./venue";
export * from "./ticket-product";

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
