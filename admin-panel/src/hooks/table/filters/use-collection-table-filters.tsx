import { useDateTableFilters } from "@hooks/table/filters/use-date-table-filters"

export const useCollectionTableFilters = () => {
  const dateFilters = useDateTableFilters()

  return dateFilters
}
