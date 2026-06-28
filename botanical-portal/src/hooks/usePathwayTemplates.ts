import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@/lib/api"
import { PATHWAY_TEMPLATES } from "@/lib/pathways"
import type { PathwayTemplate } from "@/types"

// GET /vendor/botanical/pathways/templates
export function usePathwayTemplates() {
  return useQuery<PathwayTemplate[]>({
    queryKey: ["botanical", "pathway-templates"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(PATHWAY_TEMPLATES)
      const { data } = await api.get("/vendor/botanical/pathways/templates")
      return data.templates
    },
    staleTime: 5 * 60_000,
  })
}
