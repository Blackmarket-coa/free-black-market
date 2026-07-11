import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_ANALYTICS } from "@/lib/mock/data"
import type { AnalyticsSummary } from "@/types"

// GET /vendor/plant-nursery/analytics (not built yet — mock until the route
// lands; expected response matches AnalyticsSummary)
export function useAnalytics() {
  return useQuery<AnalyticsSummary>({
    queryKey: ["analytics"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_ANALYTICS)
      const { data } = await api.get("/vendor/plant-nursery/analytics")
      return data
    },
    staleTime: 60_000,
  })
}
