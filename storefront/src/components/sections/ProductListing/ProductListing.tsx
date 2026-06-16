import { ProductListingActiveFilters } from "@/components/organisms/ProductListingActiveFilters/ProductListingActiveFilters"
import { ProductListingHeader } from "@/components/organisms/ProductListingHeader/ProductListingHeader"
import { ProductSidebar } from "@/components/organisms/ProductSidebar/ProductSidebar"
import { ProductsList } from "@/components/organisms/ProductsList/ProductsList"
import { ProductsPagination } from "@/components/organisms/ProductsPagination/ProductsPagination"
import { PRODUCT_LIMIT } from "@/const"
import { listCategories, listProductTypes, listSalesChannels } from "@/lib/data/categories"
import { listUnifiedProducts } from "@/lib/listing/unified-products"

export const ProductListing = async ({
  category_id,
  collection_id,
  seller_id,
  seller_handle,
  showSidebar = false,
  locale = process.env.NEXT_PUBLIC_DEFAULT_REGION || "pl",
  page = 1,
  categories,
  productTypes,
  salesChannels,
  vendorTypes,
  sizes,
  colors,
  conditions,
  minPrice,
  maxPrice,
  query,
}: {
  category_id?: string
  collection_id?: string
  seller_id?: string
  seller_handle?: string
  showSidebar?: boolean
  locale?: string
  page?: number
  categories?: string[]
  productTypes?: string[]
  salesChannels?: string[]
  vendorTypes?: string[]
  sizes?: string[]
  colors?: string[]
  conditions?: string[]
  minPrice?: number
  maxPrice?: number
  query?: string
}) => {
  const [result, { categories: availableCategories }, availableProductTypes, availableSalesChannels] =
    await Promise.all([
      listUnifiedProducts({
        locale,
        page,
        limit: PRODUCT_LIMIT,
        sellerId: seller_id,
        sellerHandle: seller_handle,
        categoryId: category_id,
        collectionId: collection_id,
        categories,
        productTypes,
        salesChannels,
        vendorTypes,
        sizes,
        colors,
        conditions,
        minPrice,
        maxPrice,
        query,
        sortBy: "created_at",
      }),
      listCategories(),
      listProductTypes(),
      listSalesChannels(),
    ])

  const { products, total, totalPages } = result

  return (
    <div className="py-4">
      <ProductListingHeader total={total} />
      <div className="hidden md:block">
        <ProductListingActiveFilters />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 mt-6 gap-4">
        {showSidebar && (
            <ProductSidebar
            categories={availableCategories.map((c) => ({ name: c.name }))}
            productTypes={availableProductTypes}
            salesChannels={availableSalesChannels}
          />
        )}
        <section className={showSidebar ? "col-span-3" : "col-span-4"}>
          <div className="flex flex-wrap gap-4">
            <ProductsList products={products} />
          </div>
          <ProductsPagination pages={totalPages} />
        </section>
      </div>
    </div>
  )
}
