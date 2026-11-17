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
 * One thing the page asks for is not for rendering and must not reach a
 * browser: `seller.products`. Until SD-118 the link returned every product of
 * the seller, drafts and products outside the storefront's sales channel
 * included; the backend now serves it as the listing would (published, in the
 * key's channel). It is still only the list of handles to ask the listing for
 * (`moreFromSellerHandles`), and `lib/data/products.ts` still takes it off the
 * product before any component sees it: the page does not depend on the
 * backend's filter.
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
  // Which of the seller's other products to ask the listing for ("More from
  // this seller"). Never rendered and never sent to the browser: see above.
  "seller.products.id,seller.products.handle,seller.products.status",
  // "Additional attributes".
  "attribute_values.id,attribute_values.value,attribute_values.attribute.id,attribute_values.attribute.name",
].join(",")

/**
 * The count of each variant left in stock. Medusa answers it only when exactly
 * one sales channel resolves for the request: with a publishable key linked to
 * none or to several it refuses the whole request (400, "Inventory
 * availability cannot be calculated in the given context").
 */
export const STOCK_FIELD = "variants.inventory_quantity"

/**
 * The page's fields without the stock count, for a storefront whose
 * publishable key does not resolve to one sales channel. The page then sells
 * every priced variant and the cart, which does know the stock, refuses the
 * ones with none left.
 */
export const PRODUCT_PAGE_FIELDS_WITHOUT_STOCK = PRODUCT_PAGE_FIELDS.split(",")
  .filter((field) => field !== STOCK_FIELD)
  .join(",")

/** Grids and carousels: what a product card, its filters and its sort read. */
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
 * `/feed`: a card's fields, and the two more a feed item shows, the seller's
 * avatar and the product's description. Kept off the grids, which fetch up to
 * a hundred products at a time and show neither.
 */
export const PRODUCT_FEED_FIELDS = `${PRODUCT_LIST_FIELDS},description,seller.photo`

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

/**
 * The product page's request for one product by its handle. `stock: false`
 * leaves the stock count out (`PRODUCT_PAGE_FIELDS_WITHOUT_STOCK`).
 */
export const productPageQuery = ({
  handle,
  regionId,
  countryCode,
  stock = true,
}: {
  handle: string
  regionId: string
  countryCode?: string
  stock?: boolean
}) => {
  const fields = stock ? PRODUCT_PAGE_FIELDS : PRODUCT_PAGE_FIELDS_WITHOUT_STOCK
  return {
    handle: [handle],
    limit: 1,
    offset: 0,
    ...pricingContext(fields, regionId, countryCode),
    fields,
  }
}

/** How many of the seller's other products the page asks the listing for. */
export const MORE_FROM_SELLER_CANDIDATES = 8

/** How many of them "More from this seller" shows. */
export const MORE_FROM_SELLER_SHOWN = 4

type SellerProductCandidate = {
  id?: string | null
  handle?: string | null
  status?: string | null
}

/**
 * The handles to ask the listing for to fill "More from this seller": the
 * seller's other published products, a few more than are shown.
 *
 * `seller.products` is the seller's products as the backend serves the link:
 * since SD-118, the published ones in the storefront's sales channel. The
 * status check stays for a backend that does not filter (it kept drafts,
 * proposals and rejected products from using up the candidates), and it was
 * never the gate: a published product outside the channel passed it. The gate
 * is the listing itself (`GET /store/products` serves only published products
 * in the publishable key's channel), and the section renders only what that
 * returns.
 */
export const moreFromSellerHandles = (product: {
  id: string
  seller?: { products?: (SellerProductCandidate | null)[] | null } | null
}): string[] => {
  const handles: string[] = []
  for (const candidate of product.seller?.products ?? []) {
    if (handles.length === MORE_FROM_SELLER_CANDIDATES) break
    if (!candidate || candidate.status !== "published") continue
    if (!candidate.handle || candidate.id === product.id) continue
    handles.push(candidate.handle)
  }
  return handles
}

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
