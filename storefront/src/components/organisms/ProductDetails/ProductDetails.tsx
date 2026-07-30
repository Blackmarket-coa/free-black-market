import {
  ProductDetailsFooter,
  ProductDetailsHeader,
  ProductDetailsSeller,
  ProductDetailsShipping,
  ProductPageDetails,
  ProductAdditionalAttributes,
  FarmStory,
} from "@/components/cells"

import { DirectFromProducerMessage, ProductTrustBanner } from "@/components/molecules"
import { retrieveCustomer } from "@/lib/data/customer"
import { getUserWishlists } from "@/lib/data/wishlist"
import {
  selectListingTypePresentation,
  type ListingTypePresentation,
} from "@/lib/listing/listing-type-presentation"
import { AdditionalAttributeProps } from "@/types/product"
import { SellerProps } from "@/types/seller"
import { Wishlist } from "@/types/wishlist"
import { HttpTypes } from "@medusajs/types"
import { ListingTypeInfo } from "./ListingTypeInfo"

export const ProductDetails = async ({
  product,
  locale,
  listingType = selectListingTypePresentation(null),
}: {
  product: HttpTypes.StoreProduct & {
    seller?: SellerProps
    attribute_values?: AdditionalAttributeProps[]
  }
  locale: string
  listingType?: ListingTypePresentation
}) => {
  const user = await retrieveCustomer()

  let wishlist: Wishlist[] = []
  if (user) {
    const response = await getUserWishlists()
    wishlist = response.wishlists
  }

  return (
    <div>
      <ProductDetailsHeader
        product={product}
        locale={locale}
        user={user}
        wishlist={wishlist}
      />
      {/* Listing-type badge + type-appropriate buyer hint */}
      <ListingTypeInfo listingType={listingType} />
      {listingType.detailSlot === "event" && (
        // Extension point: the ticket-purchase panel (built by a separate
        // task) mounts into this slot for event listings.
        <section data-listing-slot="event" />
      )}
      {/* FreeBlackMarket.com: Direct-to-producer messaging */}
      <div className="my-4">
        <DirectFromProducerMessage 
          producerName={product?.seller?.name} 
        />
        <div className="mt-2">
          <ProductTrustBanner />
        </div>
      </div>
      <ProductPageDetails details={product?.description || ""} />
      <ProductAdditionalAttributes
        attributes={product?.attribute_values || []}
      />
      <FarmStory productId={product.id} />
      {/* Shipping chrome only applies to listing types that ship */}
      {listingType.showShipping && <ProductDetailsShipping />}
      <ProductDetailsSeller seller={product?.seller} />
      <ProductDetailsFooter
        tags={product?.tags || []}
        posted={product?.created_at}
      />
    </div>
  )
}
