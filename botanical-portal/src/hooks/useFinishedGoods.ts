import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_FINISHED_GOODS } from "@/lib/mock/data"
import type { FinishedGood } from "@/types"

// GET /vendor/botanical/finished-goods
export function useFinishedGoods() {
  return useQuery<FinishedGood[]>({
    queryKey: ["botanical", "finished-goods"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_FINISHED_GOODS)
      const { data } = await api.get("/vendor/botanical/finished-goods")
      return data.finished_goods
    },
    staleTime: 30_000,
  })
}
