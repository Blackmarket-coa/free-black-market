import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_NURSERY_NETWORK } from "@/lib/mock/data"
import type { NurseryNetworkData } from "@/types"

// GET /vendor/botanical/nursery-network → { nodes, requests }
// No backend route yet — the maker↔grower sourcing directory is a follow-up
// build over the nursery portal's node data. The typed mock is the contract:
// grower nodes with sourceable listings + this maker's open material requests.
export function useNurseryNetwork() {
  return useQuery<NurseryNetworkData>({
    queryKey: ["botanical", "nursery-network"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_NURSERY_NETWORK)
      const { data } = await api.get("/vendor/botanical/nursery-network")
      return data
    },
    staleTime: 60_000,
  })
}
