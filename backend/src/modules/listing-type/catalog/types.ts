/**
 * Listing-type catalog types.
 *
 * A listing-type describes the shape of an offering. See
 * `docs/LISTING_TYPES.md` for the v1 ship list and v2/v3 deferrals.
 */

export type ListingTypeId =
  | "physical_product"
  | "event"
  | "digital"
  | "recurring"
  | "wholesale"
  | "consignment"
  | "unique_inventory"
  | "bookable"
  | "campaign"

export type ListingTypeDefinition = {
  id: ListingTypeId
  display_name: string
  description: string
  /** Whether checkout engages the shipping module. */
  requires_shipping: boolean
  /** Whether the listing has a finite capacity (events, cohorts). */
  requires_capacity: boolean
  /** Whether the listing renews on a cadence. */
  requires_recurrence: boolean
  /** Whether funds are held in `hawala-ledger.EscrowAgreement` during sale lifecycle. */
  requires_escrow: boolean
  /** Whether quantity is locked to 1 (one-of-a-kind). */
  unique_inventory: boolean
}
