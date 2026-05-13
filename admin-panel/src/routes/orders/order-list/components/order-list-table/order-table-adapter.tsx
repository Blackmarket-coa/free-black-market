import type { HttpTypes } from "@medusajs/types"
import type { TableAdapter } from "../../../../../lib/table/table-adapters";
import { createTableAdapter } from "../../../../../lib/table/table-adapters"
import { useOrders } from "../../../../../hooks/api/orders"
import { useOrderTableFilters } from "./use-order-table-filters"
import { orderColumnAdapter } from "../../../../../lib/table/entity-adapters"

/**
 * Create the order table adapter with all order-specific logic
 */
export function createOrderTableAdapter(): TableAdapter<HttpTypes.AdminOrder> {
  return createTableAdapter<HttpTypes.AdminOrder>({
    entity: "orders",
    queryPrefix: "o",
    pageSize: 20,
    columnAdapter: orderColumnAdapter,

    useData: (fields, params) => {
      const { orders, count, isError, error, isLoading } = useOrders(
        {
          fields,
          ...params,
        },
        {
          placeholderData: (previousData, previousQuery) => {
            // React Query v5 passes the previous Query object (not an
            // array). The queryKey holds the params used; pull `fields`
            // off its last segment for the comparison.
            const previousKey = previousQuery?.queryKey
            const previousParams =
              (previousKey?.[previousKey.length - 1] as
                | { query?: { fields?: string } }
                | undefined) ?? undefined
            const prevFields = previousParams?.query?.fields
            if (prevFields && prevFields !== fields) {
              // Fields changed, don't use placeholder data
              return undefined
            }
            // Fields are the same, keep previous data for smooth transitions
            return previousData
          },
        }
      )

      return {
        data: orders,
        count,
        isLoading,
        isError,
        error,
      }
    },

    getRowHref: (row) => `/orders/${row.id}`,

    emptyState: {
      empty: {
        heading: "No orders found",
      }
    }
  })
}

/**
 * Hook to get the order table adapter with filters
 */
export function useOrderTableAdapter(): TableAdapter<HttpTypes.AdminOrder> {
  const filters = useOrderTableFilters()
  const adapter = createOrderTableAdapter()

  // Add dynamic filters to the adapter
  return {
    ...adapter,
    filters,
  }
}
