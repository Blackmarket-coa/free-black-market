import type { OnChangeFn, RowSelectionState } from "@tanstack/react-table"
import { useState } from "react"

import { useTranslation } from "react-i18next"
import { _DataTable } from "@components/table/data-table"
import { useVariants } from "@hooks/api"
import { useDataTable } from "@hooks/use-data-table"
import { useOrderEditItemsTableColumns } from "@routes/orders/order-create-edit/components/add-order-edit-items-table/use-order-edit-item-table-columns"
import { useOrderEditItemTableFilters } from "@routes/orders/order-create-edit/components/add-order-edit-items-table/use-order-edit-item-table-filters"
import { useOrderEditItemTableQuery } from "@routes/orders/order-create-edit/components/add-order-edit-items-table/use-order-edit-item-table-query"

const PAGE_SIZE = 50
const PREFIX = "rit"

type AddExchangeOutboundItemsTableProps = {
  onSelectionChange: (ids: string[]) => void
  currencyCode: string
}

export const AddOrderEditItemsTable = ({
  onSelectionChange,
  currencyCode,
}: AddExchangeOutboundItemsTableProps) => {
  const { t } = useTranslation()

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const updater: OnChangeFn<RowSelectionState> = (fn) => {
    const newState: RowSelectionState =
      typeof fn === "function" ? fn(rowSelection) : fn

    setRowSelection(newState)
    onSelectionChange(Object.keys(newState))
  }

  const { searchParams, raw } = useOrderEditItemTableQuery({
    pageSize: PAGE_SIZE,
    prefix: PREFIX,
  })

  const { variants = [], count } = useVariants({
    ...searchParams,
    fields: "*inventory_items.inventory.location_levels,+inventory_quantity",
  })

  const columns = useOrderEditItemsTableColumns(currencyCode)
  const filters = useOrderEditItemTableFilters()

  const { table } = useDataTable({
    data: variants,
    columns: columns,
    count,
    enablePagination: true,
    getRowId: (row) => row.id,
    pageSize: PAGE_SIZE,
    enableRowSelection: (row) => {
      const { manage_inventory, allow_backorder, inventory_quantity } =
        row.original

      if (!manage_inventory || allow_backorder) {
        return true
      }

      return (inventory_quantity ?? 0) > 0
    },
    rowSelection: {
      state: rowSelection,
      updater,
    },
  })

  return (
    <div className="flex size-full flex-col overflow-hidden">
      <_DataTable
        table={table}
        columns={columns}
        pageSize={PAGE_SIZE}
        count={count}
        filters={filters}
        pagination
        layout="fill"
        search
        orderBy={[
          { key: "product_id", label: t("fields.product") },
          { key: "title", label: t("fields.title") },
          { key: "sku", label: t("fields.sku") },
        ]}
        prefix={PREFIX}
        queryObject={raw}
      />
    </div>
  )
}
