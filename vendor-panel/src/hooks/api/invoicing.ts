import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/sdk"

/**
 * Stored invoice lifecycle, matching `InvoiceStatus` in the backend's
 * accounts-receivable module.
 *
 * `sent` was this API's name for `issued` before the module landed and is
 * still accepted by the backend as an alias, but it is not written here —
 * the panel speaks the current vocabulary.
 */
export type InvoiceState = "draft" | "issued" | "paid" | "void" | "written_off"

/**
 * What a reader sees, which is wider than what is stored: `overdue` and
 * `partially_paid` are derived by the backend from (due date, payments, now)
 * rather than stored, so a missed sweep can never make them stale.
 */
export type InvoicePresentationState = InvoiceState | "overdue" | "partially_paid"

export type InvoiceRecord = {
  id: string
  invoice_number: string
  order_id: string | null
  customer_id: string | null
  status: InvoiceState
  presentation_status: InvoicePresentationState
  total: number
  amount_paid: number
  outstanding: number
  currency_code: string
  terms_days: number
  issued_at: string | null
  due_at: string | null
  paid_at: string | null
}

export type AgingSummary = {
  buckets: Record<"current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus", number>
  total_outstanding: number
  invoice_count: number
  as_of: string
}

export const useInvoices = () => {
  return useQuery({
    queryKey: ["invoices"],
    queryFn: async () =>
      sdk.client.fetch<{ invoices: InvoiceRecord[] }>("/vendor/invoices"),
  })
}

export const useInvoiceAging = () => {
  return useQuery({
    queryKey: ["invoices", "aging"],
    queryFn: async () => sdk.client.fetch<AgingSummary>("/vendor/invoices/aging"),
  })
}

/**
 * Create an invoice.
 *
 * `customer_id` is what makes net terms work: the backend resolves the buyer's
 * payment terms from their tier at issue time, so an invoice created without a
 * customer is silently Net-0 no matter what tier that buyer is in. It is
 * required here rather than optional for exactly that reason.
 */
export const useCreateInvoice = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      customer_id: string
      order_id?: string
      total: number
      currency_code?: string
      memo?: string
      /** Defaults to true on the backend — issuing starts the terms clock. */
      issue?: boolean
      terms_days?: number
    }) =>
      sdk.client.fetch<{ invoice: InvoiceRecord }>("/vendor/invoices", {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  })
}

/**
 * Move an invoice through its lifecycle.
 *
 * Note the route: per-invoice, not the collection. `paid` is deliberately not
 * reachable here — settling is a consequence of recorded payment, so that the
 * ledger can always say when the money arrived and how. Use
 * `useRecordInvoicePayment`.
 */
export const useUpdateInvoiceState = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      id: string
      status: Exclude<InvoiceState, "paid">
      reason?: string
    }) =>
      sdk.client.fetch<{ invoice: InvoiceRecord }>(
        `/vendor/invoices/${payload.id}`,
        { method: "PATCH", body: { status: payload.status, reason: payload.reason } }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  })
}

/**
 * Record money received against an invoice.
 *
 * `idempotency_key` is required by the backend so a retried or double-clicked
 * payment cannot credit the buyer twice. It is derived from the invoice and
 * the amount, so clicking "Record payment" twice for the same outstanding
 * balance collides (correct — it is one logical payment), while a genuine
 * second payment for a different amount gets its own key.
 */
export const useRecordInvoicePayment = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      id: string
      amount: number
      method?: string
      reference?: string
    }) =>
      sdk.client.fetch<{ invoice: InvoiceRecord }>(
        `/vendor/invoices/${payload.id}/payments`,
        {
          method: "POST",
          body: {
            amount: payload.amount,
            method: payload.method ?? "manual",
            reference: payload.reference,
            idempotency_key: `${payload.id}:${payload.amount}`,
          },
        }
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  })
}
