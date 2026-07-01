import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_PATHWAYS } from "@/lib/mock/data"
import type { ProductionPathway } from "@/types"

// GET /vendor/botanical/pathways
// The active pathways drive every conditional section in the portal. Load this
// at the top of any pathway-aware page.
export function useActivePathways() {
  return useQuery<ProductionPathway[]>({
    queryKey: ["botanical", "pathways"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_PATHWAYS)
      const { data } = await api.get("/vendor/botanical/pathways")
      return data.pathways
    },
    staleTime: 60_000,
  })
}
