/**
 * What the storefront asks `GET /store/products` for.
 *
 * From 2026-06-16 every product fetch sent `fields=id,title,handle,thumbnail,
 * status` and no region, as a workaround for relation expansions failing in
 * MikroORM. The backend had patched that the day before
 * (`backend/scripts/patch-mikro-orm.js`), and the workaround stayed: a product
 * page received no variants, prices, options, images or seller, so it showed
 * "Not available in your region" and a disabled button for every product, and
 * every grid lost its prices and its seller filter.
 *
 * Two lists, because a page and a card read different things. Each names the
 * fields a component reads and no more: the seller's row also holds an email,
 * a phone number, an address and a tax id, and a product handed to a client
 * component is serialised to the browser, so the seller is never asked for
 * with `*seller`.
 *
 * Pure and import-free on purpose:
 * `backend/integration-tests/http/store-product-page-query.spec.ts` loads this
 * file and issues these queries against a real database, so a field the
 * backend cannot serve fails there and not on the live page.
 */

/** `/products/[handle]` and `/shop/[handle]`: everything the detail page renders. */
export const PRODUCT_PAGE_FIELDS = [
  // Title, gallery fallback, description accordion, "Posted", subscribe marker.
  "id,title,handle,thumbnail,status,description,created_at,metadata",
  // Gallery, tag chips, the option pickers.
  "*images,*tags,*options,*options.values",
  // The variant a buyer adds to the cart: its options, its price in the
  // region, and how many are left.
  "*variants,*variants.options,*variants.calculated_price,variants.inventory_quantity",
  // The seller block, the chat room id and the suspended-seller gate.
  "seller.id,seller.name,seller.handle,seller.photo,seller.store_status",
  "seller.reviews.id,seller.reviews.rating,seller.reviews.customer_note,seller.reviews.seller_note",
  "seller.reviews.created_at,seller.reviews.updated_at",
  "seller.reviews.customer.first_name,seller.reviews.customer.last_name,seller.reviews.seller.name",
  // "More from this seller".
  "seller.products.id,seller.products.handle,seller.products.title,seller.products.thumbnail",
  // "Additional attributes".
  "attribute_values.id,attribute_values.value,attribute_values.attribute.id,attribute_values.attribute.name",
].join(",")

/** Grids, carousels and feeds: what a product card, its filters and its sort read. */
export const PRODUCT_LIST_FIELDS = [
  "id,title,handle,thumbnail,created_at,metadata",
  // The card's price, the price sort and range filter, the size/colour facets.
  "variants.id,variants.metadata,*variants.calculated_price",
  // The seller's name on the card, the seller filter, the suspended-seller gate.
  "seller.id,seller.name,seller.handle,seller.store_status",
  // The category, type and sales-channel facets.
  "categories.id,categories.name,type.id,type.value,sales_channels.id,sales_channels.name",
].join(",")

/**
 * Medusa calculates a variant's price only for a region, and refuses the
 * request (400, "Missing required pricing context") when prices are asked for
 * without one.
 */
export const asksForPrices = (fields: string): boolean =>
  fields.includes("calculated_price")

/**
 * The region, and the country its taxes are calculated for, when the field
 * list asks for prices. Nothing otherwise: a region on a request that did not
 * ask for prices makes Medusa calculate them anyway.
 */
export const pricingContext = (
  fields: string,
  regionId: string,
  countryCode?: string
): { region_id?: string; country_code?: string } =>
  asksForPrices(fields)
    ? { region_id: regionId, country_code: countryCode }
    : {}

/** The product page's request for one product by its handle. */
export const productPageQuery = ({
  handle,
  regionId,
  countryCode,
}: {
  handle: string
  regionId: string
  countryCode?: string
}) => ({
  handle: [handle],
  limit: 1,
  offset: 0,
  ...pricingContext(PRODUCT_PAGE_FIELDS, regionId, countryCode),
  fields: PRODUCT_PAGE_FIELDS,
})

/** A listing's request, before the caller's own filters are spread over it. */
export const productListQuery = ({
  fields = PRODUCT_LIST_FIELDS,
  regionId,
  countryCode,
  limit,
  offset,
  categoryId,
  collectionId,
}: {
  fields?: string
  regionId: string
  countryCode?: string
  limit: number
  offset: number
  categoryId?: string
  collectionId?: string
}) => ({
  category_id: categoryId,
  collection_id: collectionId,
  limit,
  offset,
  ...pricingContext(fields, regionId, countryCode),
  fields,
})
