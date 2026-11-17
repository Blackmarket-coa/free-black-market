import { toHandle } from "@medusajs/framework/utils"

/** Why a store name is refused, in words an applicant can act on. */
export const STORE_NAME_NEEDS_LATIN =
  "A store name needs at least one Latin letter or digit, which the store's web address uses."

/**
 * The handle, the store's web address, that Mercur's createSellerStep gives a
 * store with this name, or null when that handle would have no letter or digit.
 *
 * The step writes `handle: toHandle(input.name)` after spreading its input, so
 * no explicit handle can be passed (read in @mercurjs/b2c-core 1.5.0
 * workflows/seller/steps/create-seller.js), and handles are unique among live
 * stores. toHandle keeps only a-z, 0-9 and hyphens, so a name with no Latin
 * letter or digit makes "-" (two or more words) or "" (one word): measured,
 * «Ферма Один» was approved with handle "-", «Ферма Два» was then refused as
 * "already exists", and «日本の農場» was approved with handle "".
 */
export function storeHandleFor(name: string): string | null {
  const handle = toHandle(name)
  return /[a-z0-9]/.test(handle) ? handle : null
}
