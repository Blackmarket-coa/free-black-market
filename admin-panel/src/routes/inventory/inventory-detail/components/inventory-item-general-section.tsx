import { Container, Heading } from "@medusajs/ui"
import { HttpTypes } from "@medusajs/types"
import { PencilSquare } from "@medusajs/icons"
import { useTranslation } from "react-i18next"

import { ActionMenu } from "../../../../components/common/action-menu"
import { SectionRow } from "../../../../components/common/section"

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
      <SectionRow
        title={t("fields.inStock")}
        value={getQuantityFormat(
          (inventoryItem as { stocked_quantity?: number }).stocked_quantity ??
            0
        )}
      />

      <SectionRow
        title={t("inventory.reserved")}
        value={getQuantityFormat(
          (inventoryItem as { reserved_quantity?: number })
            .reserved_quantity ?? 0
        )}
      />
      <SectionRow
        title={t("inventory.available")}
        value={getQuantityFormat(
          ((inventoryItem as { stocked_quantity?: number })
            .stocked_quantity ?? 0) -
            ((inventoryItem as { reserved_quantity?: number })
              .reserved_quantity ?? 0)
        )}
      />
    </Container>
  )
}
