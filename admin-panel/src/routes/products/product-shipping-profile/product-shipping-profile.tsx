import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../components/modals"
import { useProduct } from "../../../hooks/api/products"
import { PRODUCT_DETAIL_FIELDS } from "../product-detail/constants"
import { ProductShippingProfileForm } from "./components/product-organization-form"

export const ProductShippingProfile = () => {
  const { id } = useParams()
  const { t } = useTranslation()

  const { product, isLoading, isError, error } = useProduct(id!, {
    fields: PRODUCT_DETAIL_FIELDS,
  })

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("products.shippingProfile.edit.header")}</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      {!isLoading && product && (
        // ProductShippingProfileForm's prop type asserts the embedded
        // shipping_profile join; the admin response includes it when
        // fetched with +shipping_profile.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <ProductShippingProfileForm product={product as any} />
      )}
    </RouteDrawer>
  )
}
