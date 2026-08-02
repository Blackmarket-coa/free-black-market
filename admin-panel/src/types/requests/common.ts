import type { MemberDTO, SellerDTO } from "@custom-types/seller";

/**
 * Request status values
 * Must match backend RequestStatus enum
 */
export type RequestStatus = "pending" | "accepted" | "rejected" | "completed" | "cancelled";

/**
 * Request type identifiers
 * Must match backend REQUEST_TYPES
 */
export type RequestType =
  | "seller"
  | "seller_creation"
  | "custom_order"
  | "quote_request"
  | "product_change"
  | "review_removal"
  | "return_request";

/**
 * Vendor types available for sellers
 * Must match backend VendorType enum
 */
export type VendorType = "producer" | "garden" | "kitchen" | "maker" | "restaurant" | "mutual_aid" | "creator" | "general";

export type RequestDTO = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  submitter_id: string;
  reviewer_id: string | null;
  reviewer_note: string | null;
  status: RequestStatus;
  created_at: Date;
  updated_at: Date;
};

export interface AdminRequest {
  id?: string;
  created_at?: string;
  updated_at?: string;
  type?: string;
  data?: Record<string, unknown>;
  submitter_id?: string;
  reviewer_id?: string | null;
  reviewer_note?: string | null;
  status?: RequestStatus;
  seller?: {
    id?: string;
    name?: string;
  };
}

export interface ReviewRemoveRequest {
  type: "review_remove";
  data: {
    review_id?: string;
    reason?: string;
  };
}

export interface OrderReturnRequestLineItem {
  id: string;
  line_item_id: string;
  quantity: number;
}

export interface AdminOrderReturnRequest {
  id: string;
  customer_id?: string;
  customer_note?: string;
  vendor_reviewer_id?: string;
  vendor_reviewer_note?: string;
  vendor_reviewer_date?: string;
  admin_reviewer_id?: string;
  admin_reviewer_note?: string;
  admin_reviewer_date?: string;
  status?: "pending" | "refunded" | "withdrawn" | "escalated" | "canceled";
  order?: {
    id?: string;
    customer?: {
      first_name?: string;
      last_name?: string;
    };
  };
  seller?: {
    id?: string;
    name?: string;
  };
  line_items?: OrderReturnRequestLineItem[];
  created_at?: string;
  updated_at?: string;
}

export interface AdminReviewRequest {
  reviewer_note?: string;
  status?: "accepted" | "rejected";
}

export interface AdminUpdateOrderReturnRequest {
  status: string;
  admin_reviewer_note: string;
}

/**
 * Seller request data structure
 *
 * `name` and `email` are legacy top-level fields kept optional so the
 * request-seller-detail screen can render rows submitted before the
 * payload was normalised into {member, seller}. They should never be
 * populated for new seller submissions.
 */
export interface SellerRequestData {
  auth_identity_id: string;
  member: MemberDTO;
  seller: SellerDTO;
  vendor_type?: VendorType;
  /** Legacy top-level name; superseded by `seller.name` / `member.name`. */
  name?: string;
  /** Legacy top-level email; superseded by `member.email`. */
  email?: string;
}

export interface AdminSellerRequest extends Omit<RequestDTO, 'data' | 'reviewer_id' | 'reviewer_note'> {
  data: SellerRequestData;
  reviewer_id?: string | null;
  reviewer_note?: string | null;
}
