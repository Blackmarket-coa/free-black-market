import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@/lib/api"
import { MOCK_COMPLIANCE } from "@/lib/mock/data"
import type { ComplianceOverview } from "@/types"

// GET /vendor/botanical/compliance/overview
export function useCompliance() {
  return useQuery<ComplianceOverview>({
    queryKey: ["botanical", "compliance"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_COMPLIANCE)
      const { data } = await api.get("/vendor/botanical/compliance/overview")
      return data
    },
    staleTime: 60_000,
  })
}
