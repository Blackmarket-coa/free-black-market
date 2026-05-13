import { Container, Heading } from "@medusajs/ui"
import type { HttpTypes } from "@medusajs/types"
import { PencilSquare } from "@medusajs/icons"
import { useTranslation } from "react-i18next"

import { ActionMenu } from "@components/common/action-menu"
import { SectionRow } from "@components/common/section"

type InventoryItemGeneralSectionProps = {
  inventoryItem: HttpTypes.AdminInventoryItemResponse["inventory_item"]
}
export const InventoryItemGeneralSection = ({
  inventoryItem,
}: InventoryItemGeneralSectionProps) => {
  const { t } = useTranslation()

  const getQuantityFormat = (quantity: number) => {
    if (quantity !== undefined && !isNaN(quantity)) {
      return t("inventory.quantityAcrossLocations", {
        quantity,
        locations: inventoryItem.location_levels?.length,
      })
    }

    return "-"
  }
  
return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading>
          {inventoryItem.title ?? inventoryItem.sku} {t("fields.details")}
        </Heading>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  icon: <PencilSquare />,
                  label: t("actions.edit"),
                  to: "edit",
                },
              ],
            },
          ]}
        />
      </div>
      <SectionRow title={t("fields.sku")} value={inventoryItem.sku ?? "-"} />
      {(() => {
        // AdminInventoryItem in @medusajs/types omits the rolled-up
        // stocked / reserved totals (they live on AdminInventoryLevel
        // per-location); the admin response embeds them on the item
        // anyway, so read through a structural cast.
        const totals = inventoryItem as unknown as {
          stocked_quantity?: number
          reserved_quantity?: number
        }
        const stocked = totals.stocked_quantity ?? 0
        const reserved = totals.reserved_quantity ?? 0

        return (
          <>
            <SectionRow
              title={t("fields.inStock")}
              value={getQuantityFormat(stocked)}
            />
            <SectionRow
              title={t("inventory.reserved")}
              value={getQuantityFormat(reserved)}
            />
            <SectionRow
              title={t("inventory.available")}
              value={getQuantityFormat(stocked - reserved)}
            />
          </>
        )
      })()}
    </Container>
  )
}
