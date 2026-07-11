import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_ORDERS } from "@/lib/mock/data"
import type { BotanicalOrder } from "@/types"

// GET /vendor/orders → { orders } (marketplace-wide vendor orders endpoint;
// same consumption pattern as nursery-portal/src/hooks/useOrders.ts).
export function useOrders() {
  return useQuery<BotanicalOrder[]>({
    queryKey: ["botanical", "orders"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_ORDERS)
      const { data } = await api.get("/vendor/orders")
      return data.orders ?? data
    },
    staleTime: 30_000,
  })
}
