/**
 * Whether every seller in a cart has a shipping method, which is what
 * Mercur's checkout requires: `splitAndCompleteCartWorkflow` pairs each
 * seller's lines with that seller's method and refuses the cart with 400
 * "Seller shipping method not found!" otherwise. It refuses only after it has
 * authorized the card (measured by the checkout scout; the hold is released by
 * its compensation), so the delivery step and Place order check first.
 *
 * What the storefront can know, and what it cannot:
 *
 * - The sellers in the cart: each line's `product.seller` (the cart query
 *   asks for its id and name).
 * - The options Mercur offers (`GET /store/shipping-options?cart_id=`), each
 *   with its `seller_id`. Mercur lists options only for sellers that have no
 *   method yet, so a listed seller is a seller still to choose for.
 * - The cart's shipping methods, but not their sellers. The cart read cannot
 *   carry them: asking `GET /store/carts/:id` for
 *   `shipping_methods.shipping_option.seller.id` answers 500 ("Cannot resolve
 *   alias path"), measured on Postgres, because Medusa's read-only
 *   cart-shipping-option link does not resolve on this backend. So a method
 *   is paired with its seller only when the storefront saw that option listed
 *   (the buyer chose it on this page); any other method is counted, one per
 *   seller, as Mercur keeps at most one method per seller.
 *
 * Pure TS with no imports, so the checkout's components and their tests share
 * one rule.
 */

export type CartSeller = { id: string; name: string }

type SellerLike = { id?: unknown; name?: unknown }

/**
 * The parts of a cart this reads. A line is read loosely (`product.seller` is
 * Mercur's link, not part of Medusa's line item type).
 */
export type CartForShipping = {
  items?: ReadonlyArray<unknown> | null
  shipping_methods?: ReadonlyArray<{ shipping_option_id?: string | null } | null | undefined> | null
}

const sellerOfLine = (item: unknown): SellerLike | undefined => {
  const product = (item as { product?: unknown } | null | undefined)?.product
  const seller = (product as { seller?: unknown } | null | undefined)?.seller
  return seller && typeof seller === "object" ? (seller as SellerLike) : undefined
}

/** An option as Mercur lists it for a cart: its id and the seller it belongs to. */
export type OfferedOption = { id?: string | null; seller_id?: string | null } | null | undefined

/** The sellers of a cart's lines, once each, in the order the lines show them. */
export function sellersInCart(cart: CartForShipping | null | undefined): CartSeller[] {
  const sellers = new Map<string, CartSeller>()
  for (const item of cart?.items ?? []) {
    const seller = sellerOfLine(item)
    const id = typeof seller?.id === "string" ? seller.id : ""
    if (id && !sellers.has(id)) {
      sellers.set(id, { id, name: typeof seller?.name === "string" ? seller.name.trim() : "" })
    }
  }
  return [...sellers.values()]
}

export type ShippingCoverage = {
  /** Every seller in the cart has a shipping method: the order can be placed. */
  complete: boolean
  /** Sellers still without a method that have options for this address: the buyer chooses for them. */
  toChoose: CartSeller[]
  /**
   * Sellers without a method and without any option for this address: their
   * lines cannot be checked out here. When `noOptionsExact` is false these are
   * candidates, not certainties (see `noOptionsCount`).
   */
  noOptions: CartSeller[]
  /** False when some methods could not be paired with a seller, so `noOptions` may name a seller that has one. */
  noOptionsExact: boolean
  /** How many sellers have neither a method nor an option, exact even when their names are not. */
  noOptionsCount: number
}

/**
 * Which sellers in the cart still need a shipping method.
 *
 * @param offered the options Mercur lists for the cart. Without them (not
 *   fetched, or the fetch failed) only the number of methods against the
 *   number of sellers can be compared, and no seller can be named.
 * @param knownPairs option id → seller id for options seen listed earlier,
 *   such as the one the buyer just chose (Mercur stops listing a seller's
 *   options once the seller has a method).
 */
export function shippingCoverage(
  cart: CartForShipping | null | undefined,
  offered?: ReadonlyArray<OfferedOption> | null,
  knownPairs: Readonly<Record<string, string>> = {}
): ShippingCoverage {
  const sellers = sellersInCart(cart)
  const methods = (cart?.shipping_methods ?? []).filter(Boolean)

  const pairs: Record<string, string> = { ...knownPairs }
  for (const option of offered ?? []) {
    if (option?.id && option.seller_id) pairs[option.id] = option.seller_id
  }

  const covered = new Set<string>()
  let unpaired = 0
  for (const method of methods) {
    const seller = method?.shipping_option_id ? pairs[method.shipping_option_id] : undefined
    if (seller) covered.add(seller)
    else unpaired += 1
  }

  const listed = new Set((offered ?? []).map((option) => option?.seller_id).filter(Boolean))
  const uncovered = sellers.filter((seller) => !covered.has(seller.id))
  const toChoose = offered ? uncovered.filter((seller) => listed.has(seller.id)) : []
  // Neither paired with a method nor listed: covered by one of the unpaired
  // methods, or with no option for this address.
  const rest = offered ? uncovered.filter((seller) => !listed.has(seller.id)) : uncovered
  const noOptionsCount = Math.max(0, rest.length - unpaired)

  return {
    complete: methods.length > 0 && toChoose.length === 0 && noOptionsCount === 0,
    toChoose,
    noOptions: offered && noOptionsCount > 0 ? rest : [],
    noOptionsExact: unpaired === 0,
    noOptionsCount: offered ? noOptionsCount : 0,
  }
}

/** "A", "A and B", "A, B and C"; `or` for a list of candidates. */
export function listNames(names: string[], conjunction: "and" | "or" = "and"): string {
  const shown = names.map((name) => name.trim()).filter(Boolean)
  if (shown.length <= 1) return shown[0] ?? ""
  return `${shown.slice(0, -1).join(", ")} ${conjunction} ${shown[shown.length - 1]}`
}

/** The fulfillment types the delivery step groups options by. */
export const FULFILLMENT_TYPES = ["delivery", "pickup", "shipping"] as const
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number]

/**
 * The fulfillment type whose options the delivery step shows: the one the
 * buyer picked while it still has options; otherwise the only type that has
 * any; otherwise none, and the buyer picks.
 *
 * Derived on every render instead of set by an effect. The effect it
 * replaces ran on every render (its dependencies were arrays rebuilt each
 * time) and set the type from the cart's first method; Mercur no longer lists
 * the option of a seller that has a method, so it fell through to Shipping
 * every time and undid the buyer's pick of Pickup or Delivery for the next
 * seller, whose cart could then never complete.
 */
export function shownFulfillmentType(
  picked: FulfillmentType | undefined,
  offered: Readonly<Record<FulfillmentType, boolean>>
): FulfillmentType | undefined {
  if (picked && offered[picked]) return picked
  const types = FULFILLMENT_TYPES.filter((type) => offered[type])
  return types.length === 1 ? types[0] : undefined
}
