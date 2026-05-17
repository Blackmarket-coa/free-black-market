import { useLoaderData, useParams } from "react-router-dom"

import { TwoColumnPageSkeleton } from "@components/common/skeleton"
import { TwoColumnPage } from "@components/layout/pages"
import { useInventoryItem } from "@hooks/api/inventory"
import { InventoryItemAttributeSection } from "@routes/inventory/inventory-detail/components/inventory-item-attributes/attributes-section"
import { InventoryItemGeneralSection } from "@routes/inventory/inventory-detail/components/inventory-item-general-section"
import { InventoryItemLocationLevelsSection } from "@routes/inventory/inventory-detail/components/inventory-item-location-levels"
import { InventoryItemReservationsSection } from "@routes/inventory/inventory-detail/components/inventory-item-reservations"
import { InventoryItemVariantsSection } from "@routes/inventory/inventory-detail/components/inventory-item-variants/variants-section"
import type { inventoryItemLoader } from "@routes/inventory/inventory-detail/loader"

import { useExtension } from "@providers/extension-provider"
import { INVENTORY_DETAIL_FIELDS } from "@routes/inventory/inventory-detail/constants"

export const InventoryDetail = () => {
  const { id } = useParams()

  const initialData = useLoaderData() as Awaited<
    ReturnType<typeof inventoryItemLoader>
  >

  const {
    inventory_item,
    isPending: isLoading,
    isError,
    error,
  } = useInventoryItem(
    id!,
    {
      fields: INVENTORY_DETAIL_FIELDS,
    },
    {
      initialData,
    }
  )

  const { getWidgets } = useExtension()

  if (isLoading || !inventory_item) {
    return (
      <TwoColumnPageSkeleton
        showJSON
        mainSections={3}
        sidebarSections={2}
        showMetadata
      />
    )
  }

  if (isError) {
    throw error
  }

  return (
    <TwoColumnPage
      widgets={{
        after: getWidgets("inventory_item.details.after"),
        before: getWidgets("inventory_item.details.before"),
        sideAfter: getWidgets("inventory_item.details.side.after"),
        sideBefore: getWidgets("inventory_item.details.side.before"),
      }}
      data={inventory_item}
      showJSON
      showMetadata
    >
      <TwoColumnPage.Main>
        <InventoryItemGeneralSection inventoryItem={inventory_item} />
        <InventoryItemLocationLevelsSection inventoryItem={inventory_item} />
        <InventoryItemReservationsSection inventoryItem={inventory_item} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <InventoryItemVariantsSection
          variants={(inventory_item as any).variants}
        />
        <InventoryItemAttributeSection inventoryItem={inventory_item as any} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}
