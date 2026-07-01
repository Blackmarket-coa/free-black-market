import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_RUNS } from "@/lib/mock/data"
import type { ProductionRun } from "@/types"

// GET /vendor/botanical/production-runs
export function useProductionRuns() {
  return useQuery<ProductionRun[]>({
    queryKey: ["botanical", "production-runs"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_RUNS)
      const { data } = await api.get("/vendor/botanical/production-runs")
      return data.runs
    },
    staleTime: 30_000,
  })
}
