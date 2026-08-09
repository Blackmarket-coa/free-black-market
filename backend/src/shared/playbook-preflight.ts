import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { getRecipe } from "../modules/playbook/recipes"
import type { PlaybookId } from "../modules/playbook/recipes"

/**
 * Playbook-switch preflight: which of a seller's listings would no longer fit
 * the playbook they're considering.
 *
 * Allowed-listing-types is enforced on *write* — `enforceListingTypeAllowed`
 * runs as a route middleware on vendor product-create, not as a DB constraint
 * and not retroactively (see `shared/listing-type-guard.ts`). So switching
 * playbooks never breaks an existing product: it keeps loading, keeps selling,
 * and keeps fulfilling. What it does mean is that the *next edit* of a
 * now-disallowed product will be rejected.
 *
 * That is worth telling someone before they switch, which is what this is for.
 * It is advisory: nothing here blocks a switch or rewrites a product.
 */

export type StrandedListing = {
  id: string
  title: string
  listing_type_id: string
}

export type PlaybookPreflight = {
  /**
   * Number of the seller's products whose listing-type the target playbook
   * does not allow. Meaningful only when `checked` is true.
   */
  stranded_listing_count: number
  /** A sample of the affected listings, for naming names in the UI. */
  stranded_listings: StrandedListing[]
  /**
   * False when the product/listing-type read failed. A count of zero from a
   * failed check reads as "you're fine" and would be worse than saying nothing
   * — callers must surface the difference rather than treating it as zero.
   */
  checked: boolean
}

/** How many affected listings to name before falling back to a bare count. */
const SAMPLE_LIMIT = 10

const unavailable: PlaybookPreflight = {
  stranded_listing_count: 0,
  stranded_listings: [],
  checked: false,
}

/** A seller's listings reduced to what the preflight needs. */
export type SellerListings = {
  listings: StrandedListing[]
  /** False when the read failed; see `PlaybookPreflight.checked`. */
  checked: boolean
}

/**
 * Read the seller's products and their listing-types, once.
 *
 * Split out from the per-target check so a surface offering several candidate
 * playbooks (the progressions panel offers up to five) pays for one product
 * read rather than one per edge.
 *
 * Products carry exactly one listing-type via the `listing-type-product` link;
 * a product with no linked listing-type is treated as `physical_product`, the
 * universal default `resolveListingTypeId` also falls back to. That is not a
 * free pass — it is the same assumption the write path makes.
 */
export async function loadSellerListings(
  container: MedusaContainer,
  sellerId: string
): Promise<SellerListings> {
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "seller",
      fields: [
        "products.id",
        "products.title",
        "products.listing_type.catalog_id",
      ],
      filters: { id: sellerId },
    })
    const rows = data?.[0]?.products
    if (!Array.isArray(rows)) {
      return { listings: [], checked: false }
    }
    const listings: StrandedListing[] = []
    for (const product of rows) {
      if (!product?.id) continue
      listings.push({
        id: String(product.id),
        title: String(product.title ?? "Untitled listing"),
        listing_type_id:
          (product.listing_type?.catalog_id as string | undefined) ??
          "physical_product",
      })
    }
    return { listings, checked: true }
  } catch {
    // Link or module shape differs / absent — say so rather than claim zero.
    return { listings: [], checked: false }
  }
}

/** Pure: which of the already-loaded listings the target playbook disallows. */
export function strandedFor(
  loaded: SellerListings,
  to: PlaybookId
): PlaybookPreflight {
  if (!loaded.checked) {
    return unavailable
  }
  const allowed = new Set<string>(getRecipe(to).allowed_listing_types as string[])
  const stranded = loaded.listings.filter(
    (l) => !allowed.has(l.listing_type_id)
  )
  return {
    stranded_listing_count: stranded.length,
    stranded_listings: stranded.slice(0, SAMPLE_LIMIT),
    checked: true,
  }
}

/**
 * Count the seller's products that the target playbook would not allow.
 * Convenience wrapper for the single-target case (the assign route).
 */
export async function preflightPlaybookSwitch(
  container: MedusaContainer,
  args: { sellerId: string; to: PlaybookId }
): Promise<PlaybookPreflight> {
  const loaded = await loadSellerListings(container, args.sellerId)
  return strandedFor(loaded, args.to)
}
