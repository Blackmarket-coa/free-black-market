import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_NETWORK } from "@/lib/mock/data"
import type { NetworkData } from "@/types"

// GET /vendor/plant-nursery/network (hub only; not built yet — mock until the
// route lands; expected response: { totals, nodes, transfers, onboarding })
export function useNetwork() {
  return useQuery<NetworkData>({
    queryKey: ["network"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_NETWORK)
      const { data } = await api.get("/vendor/plant-nursery/network")
      return data
    },
    staleTime: 60_000,
  })
}
