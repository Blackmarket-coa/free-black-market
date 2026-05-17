import { RouteFocusModal } from "@components/modals"
import { CreateProductTypeForm } from "@routes/product-types/product-type-create/components/create-product-type-form"

export const ProductTypeCreate = () => {
  return (
    <RouteFocusModal>
      <CreateProductTypeForm />
    </RouteFocusModal>
  )
}
