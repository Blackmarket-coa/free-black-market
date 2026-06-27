import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@/lib/api"
import { MOCK_BATCHES, MOCK_STRATIFICATION } from "@/lib/mock/data"
import type { PropagationBatch, StratificationRecord } from "@/types"

export interface PropagationData {
  batches: PropagationBatch[]
  stratification: StratificationRecord[]
}

// GET /vendor/plant-nursery/propagation/batches (+ stratification)
export function usePropagation() {
  return useQuery<PropagationData>({
    queryKey: ["propagation"],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return mockResolve({
          batches: MOCK_BATCHES,
          stratification: MOCK_STRATIFICATION,
        })
      }
      const [batches, strat] = await Promise.all([
        api.get("/vendor/plant-nursery/propagation/batches"),
        api.get("/vendor/plant-nursery/propagation/stratification"),
      ])
      return { batches: batches.data, stratification: strat.data }
    },
  })
}
