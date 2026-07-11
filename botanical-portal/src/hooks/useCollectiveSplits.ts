import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_COLLECTIVE_SPLITS } from "@/lib/mock/data"
import type { CollectiveSplitsData } from "@/types"

// GET /vendor/botanical/collective/splits → current-period pool + member splits
// No backend route yet — collective revenue pooling is a follow-up build on the
// backend `collective` module. The typed mock is the contract. Collective
// operators only (route-guarded in App.tsx via useOperatorType).
export function useCollectiveSplits() {
  return useQuery<CollectiveSplitsData>({
    queryKey: ["botanical", "collective-splits"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_COLLECTIVE_SPLITS)
      const { data } = await api.get("/vendor/botanical/collective/splits")
      return data
    },
    staleTime: 60_000,
  })
}
