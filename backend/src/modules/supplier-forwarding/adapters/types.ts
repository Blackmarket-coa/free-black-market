export type SupplierApiForwardingPayload = {
  order_id: string
  supplier_id: string
  email?: string | null
  items: Array<{ title: string; quantity: number }>
  shipping_address?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

export interface SupplierForwardingAdapter {
  id: string
  forwardOrder(payload: SupplierApiForwardingPayload, options: {
    apiBaseUrl: string
    apiKey?: string | null
  }): Promise<{ external_reference?: string | null }>
}
