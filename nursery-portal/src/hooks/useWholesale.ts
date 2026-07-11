import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_WHOLESALE } from "@/lib/mock/data"
import type { WholesaleData } from "@/types"

// GET /vendor/plant-nursery/wholesale (hub only; not built yet — mock until
// the route lands; expected response: { price_sheet, buyer_requests })
export function useWholesale() {
  return useQuery<WholesaleData>({
    queryKey: ["wholesale"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_WHOLESALE)
      const { data } = await api.get("/vendor/plant-nursery/wholesale")
      return data
    },
  })
}
