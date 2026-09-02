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
import { getSellerTrust } from "@/lib/data/verification"
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
import { TicketPurchase } from "@/components/organisms/TicketPurchase/TicketPurchase"

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

  // The seller's verification level and badges, for the seller block below.
  // Null when they have no handle, no record, or the lookup fails — the block
  // then renders as it did before badges existed.
  const sellerTrust = product?.seller?.handle
    ? await getSellerTrust(product.seller.handle)
    : null

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
        // Buyer path for event listings: date -> seat -> add ticket to cart.
        <section data-listing-slot="event">
          <TicketPurchase product={product} locale={locale} />
        </section>
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
      <ProductDetailsSeller seller={product?.seller} trust={sellerTrust} />
      <ProductDetailsFooter
        tags={product?.tags || []}
        posted={product?.created_at}
        productId={product.id}
      />
    </div>
  )
}
