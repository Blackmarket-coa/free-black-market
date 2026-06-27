import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@/lib/api"
import { MOCK_ORDERS, MOCK_DOA_CLAIMS } from "@/lib/mock/data"
import type { NurseryOrder, DoaClaim } from "@/types"

export interface OrdersData {
  orders: NurseryOrder[]
  doa_claims: DoaClaim[]
}

// GET /vendor/orders (+ /vendor/plant-nursery/orders/doa-claims)
export function useOrders() {
  return useQuery<OrdersData>({
    queryKey: ["orders"],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return mockResolve({ orders: MOCK_ORDERS, doa_claims: MOCK_DOA_CLAIMS })
      }
      const [orders, doa] = await Promise.all([
        api.get("/vendor/orders"),
        api.get("/vendor/plant-nursery/orders/doa-claims"),
      ])
      return { orders: orders.data.orders ?? orders.data, doa_claims: doa.data }
    },
  })
}
