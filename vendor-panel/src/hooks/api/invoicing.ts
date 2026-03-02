import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/sdk"

export type InvoiceState = "draft" | "sent" | "paid" | "void"
export type InvoiceRecord = {
  id: string
  order_id: string
  status: InvoiceState
  total: number
  currency_code: string
  issued_at: string | null
}

export const useInvoices = () => {
  return useQuery({
    queryKey: ["invoices"],
    queryFn: async () => sdk.client.fetch<{ invoices: InvoiceRecord[] }>("/vendor/invoices"),
  })
}

export const useCreateInvoice = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Omit<InvoiceRecord, "id" | "issued_at"> & { memo?: string }) => {
      return sdk.client.fetch<{ invoice: InvoiceRecord }>("/vendor/invoices", { method: "POST", body: payload })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  })
}

export const useUpdateInvoiceState = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { id: string; status: InvoiceState }) => {
      return sdk.client.fetch<{ invoice: InvoiceRecord }>("/vendor/invoices", { method: "PATCH", body: payload })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  })
}
