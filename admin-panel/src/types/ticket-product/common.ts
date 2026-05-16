import type { HttpTypes } from "@medusajs/types";

export const RowType = {
  PREMIUM: "premium",
  BALCONY: "balcony",
  STANDARD: "standard",
  VIP: "vip",
} as const;

export type RowType = (typeof RowType)[keyof typeof RowType];

export type VenueSummary = {
  id: string;
  name: string;
  address?: string | null;
};

export type TicketProductVariant = {
  id: string;
  product_variant_id: string;
  row_type: RowType;
};

export type TicketProduct = {
  id: string;
  product_id: string;
  product?: HttpTypes.AdminProduct;
  venue: VenueSummary;
  dates: string[];
  variants?: TicketProductVariant[];
  created_at?: string;
  updated_at?: string;
};

export type CreateTicketProductVariantPrice = {
  currency_code: string;
  amount: number;
  min_quantity?: number;
  max_quantity?: number;
};

export type CreateTicketProductVariant = {
  row_type: RowType;
  seat_count: number;
  prices: CreateTicketProductVariantPrice[];
};

export type CreateTicketProductRequest = {
  name: string;
  venue_id: string;
  seller_id?: string;
  dates: string[];
  variants: CreateTicketProductVariant[];
};

export type AdminTicketProductListResponse = {
  ticket_products: TicketProduct[];
  count: number;
  limit: number;
  offset: number;
};
