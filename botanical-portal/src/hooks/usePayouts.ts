import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_PAYOUTS } from "@/lib/mock/data"
import type { PayoutsData } from "@/types"

// GET /vendor/botanical/payouts/current-period
// No backend route yet — the botanical payouts module is a follow-up build
// (mirrors /vendor/plant-nursery/payouts/current-period). Until it lands, the
// typed mock is the contract the endpoint must satisfy.
export function usePayouts() {
  return useQuery<PayoutsData>({
    queryKey: ["botanical", "payouts"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_PAYOUTS)
      const { data } = await api.get("/vendor/botanical/payouts/current-period")
      return data
    },
    staleTime: 60_000,
  })
}
