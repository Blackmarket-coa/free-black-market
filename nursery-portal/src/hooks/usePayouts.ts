import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_PAYOUTS } from "@/lib/mock/data"
import type { PayoutsData } from "@/types"

// GET /vendor/plant-nursery/payouts/* (current-period, history, karma, 1099)
export function usePayouts() {
  return useQuery<PayoutsData>({
    queryKey: ["payouts"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_PAYOUTS)
      const { data } = await api.get("/vendor/plant-nursery/payouts/current-period")
      return data
    },
  })
}
