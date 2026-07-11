import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_LISTINGS } from "@/lib/mock/data"
import type { ListingsData } from "@/types"

// GET /vendor/plant-nursery/listings (not built yet — mock until the route
// lands; expected response: { listings, order_cycles, demand_pool })
export function useListings() {
  return useQuery<ListingsData>({
    queryKey: ["listings"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_LISTINGS)
      const { data } = await api.get("/vendor/plant-nursery/listings")
      return data
    },
  })
}
