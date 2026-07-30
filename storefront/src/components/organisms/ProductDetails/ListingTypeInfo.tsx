import { Badge } from "@/components/atoms"
import type { ListingTypePresentation } from "@/lib/listing/listing-type-presentation"

/**
 * Listing-type badge + buyer-facing hint for non-default listing types.
 * Physical products (the default) render nothing so the ordinary product
 * page is unchanged.
 */

const LISTING_TYPE_HINTS: Partial<
  Record<ListingTypePresentation["catalogId"], string>
> = {
  digital:
    "Instant delivery — this item is delivered digitally right after purchase. Nothing ships.",
  recurring:
    "This is a subscription — it renews on the seller's cadence until you cancel.",
  bookable:
    "This is a bookable slot — after purchase you'll schedule a time with the seller.",
  unique_inventory:
    "One of a kind — only a single unit exists, so quantity is limited to 1.",
}

export const ListingTypeInfo = ({
  listingType,
}: {
  listingType: ListingTypePresentation
}) => {
  if (listingType.catalogId === "physical_product") return null

  const hint = LISTING_TYPE_HINTS[listingType.catalogId]

  return (
    <div className="my-4" data-listing-type={listingType.catalogId}>
      <div className="flex items-center gap-2">
        <Badge>{listingType.badgeLabel}</Badge>
        <span className="label-md text-secondary">{listingType.tagline}</span>
      </div>
      {hint && <p className="mt-2 text-sm text-gray-600">{hint}</p>}
    </div>
  )
}
