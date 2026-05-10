/**
 * Unified retail/marketplace listing presentation selector per
 * AGGRESSIVE_OPERATIONS_GUIDE.md §1.1.
 *
 * The retail shop and the vendor marketplace are presentation variants
 * of the same underlying listing record. Routing decides which template
 * renders based on:
 *   - the entry path (`/shop/...` defaults to retail, `/products/...`
 *     and `/sellers/.../products/...` default to marketplace)
 *   - the storefront context cookie (organization_id + storefront_id)
 *   - the seller handle (when the buyer is browsing a specific
 *     vendor's storefront, marketplace presentation is correct
 *     regardless of entry path)
 *
 * Pure function, no I/O. Callers fetch the storefront context separately
 * via `getStorefrontContext()` and feed it in here.
 */

export type Presentation = "retail" | "marketplace"

export type StorefrontContextLike = {
  organization_id?: string | undefined
  storefront_id?: string | undefined
}

export type SelectPresentationInput = {
  /**
   * The path segment that owns the route. Use the literal `"shop"` for
   * the public retail entry and `"products"` for the marketplace entry.
   * Anything else falls through to context-based selection.
   */
  routeKind?: "shop" | "products" | "seller" | "embed" | "other"
  storefrontContext?: StorefrontContextLike
  /**
   * Present when the buyer is on a specific vendor's storefront page;
   * marketplace presentation is the right answer in that case.
   */
  sellerHandle?: string | null
  /**
   * MXID lookup result (optional). When the buyer is a coalition member
   * with active membership, marketplace presentation is preferred so
   * they see vendor-forward chrome.
   */
  isCoalitionMember?: boolean
}

export function selectPresentation(input: SelectPresentationInput): Presentation {
  if (input.routeKind === "shop") return "retail"
  if (input.sellerHandle) return "marketplace"
  if (input.routeKind === "embed") return "marketplace"

  if (input.storefrontContext?.organization_id && input.storefrontContext?.storefront_id) {
    return "marketplace"
  }

  if (input.isCoalitionMember) return "marketplace"

  if (input.routeKind === "products") return "marketplace"

  return "retail"
}
