import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@/lib/api"
import { MOCK_DASHBOARD } from "@/lib/mock/data"
import type { DashboardSummary } from "@/types"

// GET /vendor/plant-nursery/dashboard-summary
export function useDashboard() {
  return useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_DASHBOARD)
      const { data } = await api.get("/vendor/plant-nursery/dashboard-summary")
      return data
    },
    staleTime: 60_000,
  })
}
