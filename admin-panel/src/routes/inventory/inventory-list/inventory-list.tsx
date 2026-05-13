import { SingleColumnPage } from "@components/layout/pages"
import { useExtension } from "@providers/extension-provider"
import { InventoryListTable } from "@routes/inventory/inventory-list/components/inventory-list-table"

export const InventoryItemListTable = () => {
  const { getWidgets } = useExtension()

  return (
    <SingleColumnPage
      widgets={{
        after: getWidgets("inventory_item.list.after"),
        before: getWidgets("inventory_item.list.before"),
      }}
    >
      <InventoryListTable />
    </SingleColumnPage>
  )
}
