import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@/lib/api"
import { MOCK_FORMULAS } from "@/lib/mock/data"
import type { Formula } from "@/types"

// GET /vendor/botanical/formulas?pathway_id=xxx
export function useFormulas(pathwayId?: string) {
  return useQuery<Formula[]>({
    queryKey: ["botanical", "formulas", pathwayId ?? "all"],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        const all = pathwayId
          ? MOCK_FORMULAS.filter((f) => f.pathway_id === pathwayId)
          : MOCK_FORMULAS
        return mockResolve(all)
      }
      const { data } = await api.get("/vendor/botanical/formulas", {
        params: pathwayId ? { pathway_id: pathwayId } : undefined,
      })
      return data.formulas
    },
    staleTime: 30_000,
  })
}
