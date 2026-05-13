import { useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../components/modals"
import { useProductVariant } from "../../../hooks/api/products"
import { VARIANT_DETAIL_FIELDS } from "../product-variant-detail/constants.ts"
import { ManageVariantInventoryItemsForm } from "./components/manage-variant-inventory-items-form"

export function ProductVariantManageInventoryItems() {
  const { id, variant_id } = useParams()

  const {
    variant,
    isPending: isLoading,
    isError,
    error,
  } = useProductVariant(id!, variant_id!, {
    fields: VARIANT_DETAIL_FIELDS,
  })

  if (isError) {
    throw error
  }

  return (
    <RouteFocusModal>
      {!isLoading && variant && (
        // The admin response embeds the variant's inventory_items join
        // when fetched with VARIANT_DETAIL_FIELDS, which the SDK type
        // doesn't model. Cast through any to relax the join shape.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <ManageVariantInventoryItemsForm variant={variant as any} />
      )}
    </RouteFocusModal>
  )
}
