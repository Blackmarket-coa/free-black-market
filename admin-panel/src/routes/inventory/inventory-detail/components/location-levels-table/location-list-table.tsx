import { DataTable } from "@components/data-table"
import { useInventoryItemLevels } from "@hooks/api/inventory"
import {
  useLocationListTableColumns,
  type ExtendedLocationLevel,
} from "@routes/inventory/inventory-detail/components/location-levels-table/use-location-list-table-columns"
import { useLocationLevelTableQuery } from "@routes/inventory/inventory-detail/components/location-levels-table/use-location-list-table-query"

const PAGE_SIZE = 20
const PREFIX = "invlvl"

export const ItemLocationListTable = ({
  inventory_item_id,
}: {
  inventory_item_id: string
}) => {
  const searchParams = useLocationLevelTableQuery({
    pageSize: PAGE_SIZE,
    prefix: PREFIX,
  })

  const {
    inventory_levels,
    count,
    isPending: isLoading,
    isError,
    error,
  } = useInventoryItemLevels(inventory_item_id, {
    ...searchParams,
    fields: "+stock_locations.id,+stock_locations.name",
  })

  const columns = useLocationListTableColumns()

  if (isError) {
    throw error
  }

  return (
    <DataTable
      // The /admin/inventory-items/{id}/location-levels response inflates
      // each row with stock_locations + level totals; the SDK type only
      // sees the base InventoryLevel shape. ExtendedLocationLevel
      // captures the actual response shape consumed by the columns.
      data={(inventory_levels ?? []) as unknown as ExtendedLocationLevel[]}
      columns={columns}
      rowCount={count}
      pageSize={PAGE_SIZE}
      getRowId={(row) => row.id}
      isLoading={isLoading}
      prefix={PREFIX}
      layout="fill"
      enableSearch={false}
    />
  )
}
