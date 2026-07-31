/**
 * Consignment listing-type revenue split helpers.
 *
 * "A vendor sells on behalf of a represented party; revenue split is atomic
 * at order complete" (listing-type catalog: `consignment`). Dark by default:
 * the hawala-order-payment subscriber only routes the seller-side amount
 * through the split when FBM_CONSIGNMENT_SPLIT_LIVE=1 — with the flag unset
 * the single escrow->seller leg flows exactly as today.
 *
 * v1 split config lives on the sale product's metadata:
 *   - `consignor_seller_id`: seller id of the represented party
 *   - `consignor_bps`: integer basis points (0..10000) of the SELLER-side
 *     amount (post platform fee) owed to the consignor
 * and only engages when the product is linked to the `consignment` listing
 * type (`links/listing-type-product.ts`). This file is pure decision logic —
 * no container/DB access — so it is exhaustively unit-testable; the
 * subscriber does the I/O and HawalaLedgerModuleService moves the money.
 */

export const CONSIGNMENT_SPLIT_FLAG = "FBM_CONSIGNMENT_SPLIT_LIVE"
export const CONSIGNMENT_CATALOG_ID = "consignment"
export const CONSIGNOR_SELLER_ID_KEY = "consignor_seller_id"
export const CONSIGNOR_BPS_KEY = "consignor_bps"
/** Basis-point denominator: 10000 bps == 100% of the seller-side amount. */
export const CONSIGNMENT_BPS_DENOMINATOR = 10000

export function isConsignmentSplitLive(): boolean {
  return process.env[CONSIGNMENT_SPLIT_FLAG] === "1"
}

export type ConsignmentConfig = {
  consignor_seller_id: string
  consignor_bps: number
}

export type ConsignmentSplitCents = {
  consignor_cents: number
  vendor_cents: number
}

/**
 * Integer-cent bps split of the seller-side amount. The consignor gets
 * floor(sellerAmountCents * consignorBps / 10000) and the vendor keeps the
 * remainder, so the two legs always sum to exactly `sellerAmountCents` — no
 * rounding drift; the sub-cent rounding benefit goes to the vendor.
 */
export function splitConsignmentCents(
  sellerAmountCents: number,
  consignorBps: number
): ConsignmentSplitCents {
  if (!Number.isInteger(sellerAmountCents) || sellerAmountCents < 0) {
    throw new Error(
      `splitConsignmentCents sellerAmountCents must be a non-negative integer, got ${sellerAmountCents}`
    )
  }
  if (
    !Number.isInteger(consignorBps) ||
    consignorBps < 0 ||
    consignorBps > CONSIGNMENT_BPS_DENOMINATOR
  ) {
    throw new Error(
      `splitConsignmentCents consignorBps must be an integer in 0..${CONSIGNMENT_BPS_DENOMINATOR}, got ${consignorBps}`
    )
  }
  const consignor_cents = Math.floor(
    (sellerAmountCents * consignorBps) / CONSIGNMENT_BPS_DENOMINATOR
  )
  return { consignor_cents, vendor_cents: sellerAmountCents - consignor_cents }
}

export type ConsignmentProduct = {
  id?: string | null
  metadata?: Record<string, unknown> | null
  /** Resolved via the listing-type-product link (`listing_type.catalog_id`). */
  listing_type?: { catalog_id?: string | null } | null
}

/**
 * Parse `consignor_bps` metadata. Admin metadata editors commonly store
 * numbers as strings, so both 2500 and "2500" are accepted; anything
 * non-integer or outside 0..10000 is invalid.
 */
function parseConsignorBps(raw: unknown): number | null {
  let value: number
  if (typeof raw === "number") {
    value = raw
  } else if (typeof raw === "string" && /^\d{1,5}$/.test(raw.trim())) {
    value = Number(raw.trim())
  } else {
    return null
  }
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > CONSIGNMENT_BPS_DENOMINATOR
  ) {
    return null
  }
  return value
}

/**
 * Extract a consignment split config from a product's metadata, or null when
 * the metadata is absent or malformed. Does NOT check the listing type —
 * that is `resolveOrderConsignment`'s job.
 */
export function extractConsignmentConfig(
  product: ConsignmentProduct | null | undefined
): ConsignmentConfig | null {
  const metadata = product?.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null
  }
  const rawSellerId = (metadata as Record<string, unknown>)[
    CONSIGNOR_SELLER_ID_KEY
  ]
  const consignorSellerId =
    typeof rawSellerId === "string" ? rawSellerId.trim() : ""
  if (!consignorSellerId) {
    return null
  }
  const consignorBps = parseConsignorBps(
    (metadata as Record<string, unknown>)[CONSIGNOR_BPS_KEY]
  )
  if (consignorBps === null) {
    return null
  }
  return { consignor_seller_id: consignorSellerId, consignor_bps: consignorBps }
}

export type ConsignmentSkipReason =
  | "no_products"
  | "items_without_product"
  | "missing_products"
  | "no_consignment_products"
  | "metadata_without_consignment_listing"
  | "not_all_consignment"
  | "invalid_config"
  | "conflicting_configs"
  | "self_consignment"

export type OrderConsignmentResolution =
  | { config: ConsignmentConfig; reason: null }
  | { config: null; reason: ConsignmentSkipReason }

/**
 * Order-level split decision. The hawala order flow settles ONE seller-side
 * amount per order, so v1 only splits when every line item provably sells
 * the same consignment deal: each item resolves to a fetched product, every
 * product is linked to the `consignment` listing type, every product carries
 * a valid config, and all configs agree. Anything else returns a skip reason
 * (money then flows through the plain seller leg exactly as today).
 * `no_consignment_products` is the one non-anomalous reason — a plain order.
 */
export function resolveOrderConsignment(args: {
  item_product_ids: Array<string | null | undefined>
  products: ConsignmentProduct[]
  vendor_seller_id: string
}): OrderConsignmentResolution {
  if (args.item_product_ids.length === 0) {
    return { config: null, reason: "no_products" }
  }
  if (args.item_product_ids.some((id) => !id)) {
    // A custom line item without a product cannot be attributed to the
    // consignment deal; splitting the whole order would overpay the consignor.
    return { config: null, reason: "items_without_product" }
  }
  const productIds = [...new Set(args.item_product_ids as string[])]
  const byId = new Map<string, ConsignmentProduct>()
  for (const product of args.products ?? []) {
    if (product?.id) {
      byId.set(product.id, product)
    }
  }
  const products = productIds.map((id) => byId.get(id))
  if (products.some((product) => !product)) {
    return { config: null, reason: "missing_products" }
  }
  const resolved = products as ConsignmentProduct[]
  const consignmentListed = resolved.filter(
    (product) => product.listing_type?.catalog_id === CONSIGNMENT_CATALOG_ID
  )
  if (consignmentListed.length === 0) {
    // Consignor metadata without the listing-type link is a vendor
    // misconfig worth surfacing; a plain order is not.
    const anyConfig = resolved.some(
      (product) => extractConsignmentConfig(product) !== null
    )
    return {
      config: null,
      reason: anyConfig
        ? "metadata_without_consignment_listing"
        : "no_consignment_products",
    }
  }
  if (consignmentListed.length !== resolved.length) {
    return { config: null, reason: "not_all_consignment" }
  }
  const configs = consignmentListed.map(extractConsignmentConfig)
  if (configs.some((config) => config === null)) {
    return { config: null, reason: "invalid_config" }
  }
  const distinct = new Set(
    (configs as ConsignmentConfig[]).map(
      (config) => `${config.consignor_seller_id}::${config.consignor_bps}`
    )
  )
  if (distinct.size > 1) {
    return { config: null, reason: "conflicting_configs" }
  }
  const config = configs[0] as ConsignmentConfig
  if (config.consignor_seller_id === args.vendor_seller_id) {
    return { config: null, reason: "self_consignment" }
  }
  return { config, reason: null }
}
