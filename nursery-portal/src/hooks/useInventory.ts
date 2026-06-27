import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@/lib/api"
import {
  MOCK_INVENTORY_READY,
  MOCK_BATCHES,
  MOCK_MOTHER_PLANTS,
} from "@/lib/mock/data"
import type { InventoryItem, PropagationBatch, MotherPlant } from "@/types"

export interface InventoryData {
  ready: InventoryItem[]
  in_propagation: PropagationBatch[]
  mother_plants: MotherPlant[]
}

// GET /vendor/plant-nursery/inventory
export function useInventory() {
  return useQuery<InventoryData>({
    queryKey: ["inventory"],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return mockResolve({
          ready: MOCK_INVENTORY_READY,
          in_propagation: MOCK_BATCHES.filter((b) => b.status !== "ready"),
          mother_plants: MOCK_MOTHER_PLANTS,
        })
      }
      const { data } = await api.get("/vendor/plant-nursery/inventory")
      return data
    },
  })
}
