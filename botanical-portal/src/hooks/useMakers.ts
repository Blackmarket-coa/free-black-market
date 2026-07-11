import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_MAKERS } from "@/lib/mock/data"
import type { MakersData } from "@/types"

// GET /vendor/botanical/collective/makers → { makers, invites }
// No backend route yet — the collective roster is a follow-up build on the
// backend `collective` module. The typed mock is the contract. Collective
// operators only (route-guarded in App.tsx via useOperatorType).
export function useMakers() {
  return useQuery<MakersData>({
    queryKey: ["botanical", "collective-makers"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_MAKERS)
      const { data } = await api.get("/vendor/botanical/collective/makers")
      return data
    },
    staleTime: 60_000,
  })
}
