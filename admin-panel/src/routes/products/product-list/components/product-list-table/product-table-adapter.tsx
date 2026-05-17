import { createDataTableColumnHelper } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { useProducts } from "../../../../../hooks/api/products"
import { productColumnAdapter } from "../../../../../lib/table/entity-adapters"
import { createTableAdapter, TableAdapter } from "../../../../../lib/table/table-adapters"
import { useProductTableFilters } from "./use-product-table-filters"

export function createProductTableAdapter(): TableAdapter<HttpTypes.AdminProduct> {
  const columnHelper = createDataTableColumnHelper<HttpTypes.AdminProduct>()

  return createTableAdapter<HttpTypes.AdminProduct>({
    entity: "products",
    queryPrefix: "p",
    pageSize: 20,
    columnAdapter: productColumnAdapter,
    useData: (fields, params) => {
      const { products, count, isError, error, isLoading } = useProducts(
        {
          fields,
          ...params,
          is_giftcard: false, // Exclude gift cards from product list
        },
        {
          placeholderData: (previousData, previousQuery) => {
            // queryKey ends with { query: {...} }; fish `fields` out.
            const queryKey = previousQuery?.queryKey as readonly unknown[] | undefined
            const last = queryKey?.[queryKey.length - 1]
            const prevFields =
              (last as { query?: { fields?: string } } | undefined)?.query
                ?.fields
            if (prevFields && prevFields !== fields) {
              return undefined
            }
            return previousData
          },
        }
      )
      return { data: products, count, isLoading, isError, error }
    },
    getRowHref: (row) => `/products/${row.id}`,
    decorateColumns: (columns) => [columnHelper.select(), ...columns],
  })
}

/**
 * Hook to get the product table adapter with filters
 */
export function useProductTableAdapter(): TableAdapter<HttpTypes.AdminProduct> {
  const filters = useProductTableFilters()
  const adapter = createProductTableAdapter()

  // Add dynamic filters to the adapter
  return {
    ...adapter,
    filters,
  }
}
