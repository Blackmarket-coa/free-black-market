import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_RAW_MATERIALS } from "@/lib/mock/data"
import type { RawMaterial } from "@/types"

// GET /vendor/botanical/raw-materials
export function useRawMaterials() {
  return useQuery<RawMaterial[]>({
    queryKey: ["botanical", "raw-materials"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_RAW_MATERIALS)
      const { data } = await api.get("/vendor/botanical/raw-materials")
      return data.materials
    },
    staleTime: 30_000,
  })
}
