import type { UseFormReturn } from "react-hook-form"

import { StackedFocusModal } from "@components/modals"
import { FormExtensionZone } from "@/dashboard-app"
import { useExtension } from "@providers/extension-provider"
import type { ProductCreateSchemaType } from "@routes/products/product-create/types"
import { ProductCreateOrganizationSection } from "@routes/products/product-create/components/product-create-organize-form/components/product-create-organize-section"
import { ProductCreateAttributeSection } from "@routes/products/product-create/components/product-create-organize-form/components/product-create-organize-attribute-section/product-create-details-attribute-section"
import { ProductCreateSalesChannelStackedModal } from "@routes/products/product-create/components/product-create-organize-form/components/product-create-sales-channel-stacked-modal"
import { SC_STACKED_MODAL_ID } from "@routes/products/product-create/components/product-create-organize-form/constants"

type ProductAttributesProps = {
  form: UseFormReturn<ProductCreateSchemaType>
}

export const ProductCreateOrganizeForm = ({ form }: ProductAttributesProps) => {
  const { getFormFields } = useExtension()
  const fields = getFormFields("product", "create", "organize")

  return (
    <StackedFocusModal id={SC_STACKED_MODAL_ID}>
      <div className="flex flex-col items-center p-16">
        <div className="flex w-full max-w-[720px] flex-col gap-y-8">
          <ProductCreateOrganizationSection form={form} />
          <FormExtensionZone fields={fields} form={form} />
          <ProductCreateAttributeSection form={form} />
        </div>
      </div>
      <ProductCreateSalesChannelStackedModal form={form} />
    </StackedFocusModal>
  )
}
