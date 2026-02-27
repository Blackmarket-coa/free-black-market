import { useParams } from "react-router-dom"

import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { TwoColumnPage } from "../../../components/layout/pages"
import { SectionRow } from "../../../components/common/section"
import { useProduct } from "../../../hooks/api/products"
import { ProductGeneralSection } from "./components/product-general-section"
import { ProductMediaSection } from "./components/product-media-section"
import { ProductOptionSection } from "./components/product-option-section"
import { ProductOrganizationSection } from "./components/product-organization-section"
import { ProductVariantSection } from "./components/product-variant-section"

import { useDashboardExtension } from "../../../extensions"
import { ProductAdditionalAttributesSection } from "./components/product-additional-attribute-section/ProductAdditionalAttributesSection"
import { PRODUCT_DETAIL_FIELDS } from "./constants"

const FULFILLMENT_LABELS: Record<string, string> = {
  dropship: "Dropship",
  self_ship: "Self Ship",
  local: "Local Pickup",
}

export const ProductDetail = () => {
  const { id } = useParams()
  const { product, isLoading, isError, error } = useProduct(id!, {
    fields: "*variants.inventory_items,*categories",
  })

  const { getWidgets } = useDashboardExtension()

  const after = getWidgets("product.details.after")
  const before = getWidgets("product.details.before")
  const sideAfter = getWidgets("product.details.side.after")
  const sideBefore = getWidgets("product.details.side.before")

  if (isLoading || !product) {
    return <TwoColumnPageSkeleton mainSections={4} sidebarSections={3} />
  }

  if (isError) {
    throw error
  }

  const metadata = (product.metadata || {}) as Record<string, any>
  const fulfillmentType = metadata.fulfillment_type as string | undefined
  const supplierName = metadata.supplier_name as string | undefined
  const inventoryQty = metadata.inventory_quantity as number | undefined
  const lowStockThreshold = metadata.low_stock_threshold as number | undefined
  const isLowStock =
    inventoryQty != null &&
    lowStockThreshold != null &&
    inventoryQty <= lowStockThreshold

  return (
    <TwoColumnPage
      widgets={{
        after,
        before,
        sideAfter,
        sideBefore,
      }}
      data={product}
    >
      <TwoColumnPage.Main>
        <ProductGeneralSection product={product} />
        <ProductMediaSection product={product} />
        <ProductOptionSection product={product} />
        <ProductVariantSection product={product} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <ProductOrganizationSection product={product} />
        {/* Fulfillment & Supplier Section */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <Heading level="h2">Fulfillment & Supplier</Heading>
          </div>
          <SectionRow
            title="Fulfillment Type"
            value={
              fulfillmentType ? (
                <Badge size="2xsmall">
                  {FULFILLMENT_LABELS[fulfillmentType] || fulfillmentType}
                </Badge>
              ) : (
                <Text className="text-ui-fg-muted" size="small">
                  Not set
                </Text>
              )
            }
          />
          <SectionRow
            title="Supplier"
            value={supplierName || undefined}
          />
        </Container>
        {/* Inventory Section */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <Heading level="h2">Inventory</Heading>
          </div>
          <SectionRow
            title="Quantity"
            value={
              inventoryQty != null ? (
                <div className="flex items-center gap-x-2">
                  <Text size="small">{inventoryQty}</Text>
                  {isLowStock && (
                    <Badge size="2xsmall" color="orange">
                      Low Stock
                    </Badge>
                  )}
                </div>
              ) : (
                <Text className="text-ui-fg-muted" size="small">
                  Not tracked
                </Text>
              )
            }
          />
          <SectionRow
            title="Low Stock Threshold"
            value={
              lowStockThreshold != null
                ? String(lowStockThreshold)
                : undefined
            }
          />
        </Container>
        <ProductAdditionalAttributesSection product={product} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}
