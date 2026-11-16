/**
 * What the storefront asks `GET /store/carts/:id` for.
 *
 * The cart shows each line's seller in its header: the name, the link to the
 * seller's page, the avatar and the "since" date. Until SD-118 it asked for
 * the seller with `*items.product.seller`, and the backend answered with the
 * whole row: the seller's email, phone, address and tax id, on a cart any
 * visitor can create and hold in a cookie. The backend now cuts a seller to
 * its public columns whatever is asked; this list no longer asks, either.
 *
 * Every entry carries a modifier (`*`, `+`, or the leading space Medusa
 * reads as `+`). That is load-bearing: one bare field name makes Medusa
 * replace the route's default list (totals, addresses, the payment
 * collection) with this one instead of adding to it.
 *
 * Pure and import-free on purpose:
 * `backend/integration-tests/http/store-public-fields.spec.ts` loads this
 * file and sends this list through the real route.
 */
export const CART_FIELDS =
  "*items,*region, *items.product, *items.variant, *items.variant.options, items.variant.options.option.title," +
  "*items.thumbnail, *items.metadata, +items.total, *promotions, +shipping_methods.name," +
  "+items.product.seller.id,+items.product.seller.name,+items.product.seller.handle," +
  "+items.product.seller.photo,+items.product.seller.created_at"
