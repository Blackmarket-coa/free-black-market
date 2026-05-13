import type { UseFormReturn } from "react-hook-form"

import type { ProductCreateSchemaType } from "@routes/products/product-create/types"
import { ProductCreateInventoryKitSection } from "@routes/products/product-create/components/product-create-inventory-kit-form/components/product-create-inventory-kit-section/product-create-inventory-kit-section"

type ProductAttributesProps = {
  form: UseFormReturn<ProductCreateSchemaType>
}

export const ProductCreateInventoryKitForm = ({
  form,
}: ProductAttributesProps) => {
  return (
    <div className="flex flex-col items-center p-16">
      <div className="flex w-full max-w-[720px] flex-col gap-y-8">
        <ProductCreateInventoryKitSection form={form} />
      </div>
    </div>
  )
}
