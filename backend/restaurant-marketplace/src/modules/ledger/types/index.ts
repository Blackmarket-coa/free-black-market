export enum LedgerEventType {
  ORDER_CAPTURED = "order_captured",
  PLATFORM_FEE_ASSESSED = "platform_fee_assessed",
  VENDOR_PAYOUT_ACCRUED = "vendor_payout_accrued",
  DONATION_ACCRUED = "donation_accrued",
  REFUND_ISSUED = "refund_issued",
  PAYOUT_RELEASED = "payout_released",
}

export type LedgerEventInput = {
  storefront_id: string;
  event_type: LedgerEventType;
  amount: number;
  currency_code: string;
  occurred_at?: Date;
  reference_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ReconciliationInput = {
  storefront_id?: string;
  start_date: Date;
  end_date: Date;
};

export type ReconciliationResult = {
  storefront_id: string;
  start_date: Date;
  end_date: Date;
  captured_total: number;
  platform_fee_total: number;
  vendor_payout_total: number;
  donation_total: number;
  refund_total: number;
  payout_released_total: number;
  expected_allocation_total: number;
  net_vendor_obligation: number;
  allocation_difference: number;
  obligation_difference: number;
  discrepancies: string[];
};
