import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/client"

export type ProductionSource = "own" | "foraged" | "swap" | "purchased"

export interface ProductionBatch {
  id: string
  seller_id: string
  item_label: string
  method?: string | null
  start_date?: string | null
  qty_started: number
  source: ProductionSource
  controlled_environment: boolean
  yield_qty?: number | null
  status: string
}

export interface CreateBatchInput {
  item_label: string
  method?: string
  start_date?: string
  qty_started?: number
  source?: ProductionSource
  controlled_environment?: boolean
  yield_qty?: number
}

export const productionKeys = {
  all: ["production-batches"] as const,
  list: () => [...productionKeys.all, "list"] as const,
}

export const useProductionBatches = () =>
  useQuery({
    queryKey: productionKeys.list(),
    queryFn: async () => {
      const res = await sdk.client.fetch("/vendor/production-batches")
      return res as { production_batches: ProductionBatch[]; count: number }
    },
  })

export const useCreateProductionBatch = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateBatchInput) => {
      const res = await sdk.client.fetch("/vendor/production-batches", {
        method: "POST",
        body: input,
      })
      return res as { production_batch: ProductionBatch }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: productionKeys.list() }),
  })
}

export const useDeleteProductionBatch = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch("/vendor/production-batches/" + id, { method: "DELETE" })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: productionKeys.list() }),
  })
}
