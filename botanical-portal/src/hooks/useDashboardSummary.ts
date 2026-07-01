import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_DASHBOARD } from "@/lib/mock/data"
import type { DashboardSummary } from "@/types"

// GET /vendor/botanical/dashboard-summary
export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ["botanical", "dashboard-summary"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_DASHBOARD)
      const { data } = await api.get("/vendor/botanical/dashboard-summary")
      return data
    },
    staleTime: 60_000,
  })
}
