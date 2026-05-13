import { createDataTableColumnHelper } from "@medusajs/ui"
import type { HttpTypes } from "@medusajs/types"
import { useProducts } from "@hooks/api/products"
import { productColumnAdapter } from "@lib/table/entity-adapters"
import type { TableAdapter } from "@lib/table/table-adapters";
import { createTableAdapter } from "@lib/table/table-adapters"
import { useProductTableFilters } from "@routes/products/product-list/components/product-list-table/use-product-table-filters"

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
            // Only keep placeholder data if the fields haven't changed
            const prevKey = (previousQuery?.queryKey ?? []) as unknown[]
            const prevFields = (prevKey[prevKey.length - 1] as { query?: { fields?: string } } | undefined)?.query?.fields
            if (prevFields && prevFields !== fields) {
              // Fields changed, don't use placeholder data
              return undefined
            }
            // Fields are the same, keep previous data for smooth transitions
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
