import type { RowType } from "../ticket-product";

export type VenueRow = {
  id: string;
  row_number: string;
  row_type: RowType;
  seat_count: number;
};

export type Venue = {
  id: string;
  name: string;
  address: string | null;
  rows: VenueRow[];
  created_at?: string;
  updated_at?: string;
};

export type CreateVenueRow = {
  row_number: string;
  row_type: RowType;
  seat_count: number;
};

export type CreateVenueRequest = {
  name: string;
  address?: string;
  rows: CreateVenueRow[];
};

export type AdminVenueListResponse = {
  venues: Venue[];
  count: number;
  limit: number;
  offset: number;
};
