import { ProductDetails, ProductGallery } from "@/components/organisms"
import {
  getProductListingType,
  listMoreFromSeller,
  retrieveProductByHandle,
} from "@/lib/data/products"
import { HomeProductSection } from "../HomeProductSection/HomeProductSection"
import NotFound from "@/app/not-found"
import type { Presentation } from "@/lib/listing/presentation"
import { selectListingTypePresentation } from "@/lib/listing/listing-type-presentation"

export const ProductDetailsPage = async ({
  handle,
  locale,
  presentation = "marketplace",
}: {
  handle: string
  locale: string
  presentation?: Presentation
}) => {
  const prod = await retrieveProductByHandle({ handle, countryCode: locale })

  if (!prod) return null

  if (prod.seller?.store_status === "SUSPENDED") {
    return NotFound()
  }

  // Per-listing-type presentation: catalog id comes from a dedicated
  // detail-path endpoint (null on error → physical-product default).
  const catalogId = await getProductListingType(prod.id)
  const listingType = selectListingTypePresentation(catalogId)

  // The seller's other products as the listing serves them: published, in
  // this storefront's sales channel and priced here. `prod` itself carries no
  // list of the seller's products (see ProductPageProduct).
  const moreFromSeller =
    presentation === "marketplace"
      ? await listMoreFromSeller({ handle, countryCode: locale })
      : []

  return (
    <>
      <div
        className="flex flex-col md:flex-row lg:gap-12"
        data-presentation={presentation}
        data-listing-type={listingType.catalogId}
      >
        <div className="md:w-1/2 md:px-2">
          <ProductGallery images={prod?.images || []} />
        </div>
        <div className="md:w-1/2 md:px-2">
          <ProductDetails
            product={prod}
            locale={locale}
            listingType={listingType}
          />
        </div>
      </div>
      {moreFromSeller.length > 0 && (
        <div className="my-8">
          <HomeProductSection
            heading="More from this seller"
            products={moreFromSeller}
            locale={locale}
          />
        </div>
      )}
    </>
  )
}
