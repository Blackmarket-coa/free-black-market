import type { ChannelOrder, ChannelProduct } from "./types"

/**
 * Translation between FBM's product shape and Faire's.
 *
 * Pure — no HTTP, no container — because the roadmap is explicit that schema
 * translation is the hard part and the transport is not. A mapper welded to a
 * fetch call can only be tested by standing up a channel; this one asserts
 * directly, including the cases that actually bite.
 *
 * Faire's own field names are used verbatim rather than aliased, so this file
 * reads against their documentation without a decoder ring.
 */

/** What Faire rejects a listing for, expressed as one reason per problem. */
export type MappingProblem = {
  field: string
  reason: string
}

export type MappingResult<T> =
  | { ok: true; value: T; warnings: MappingProblem[] }
  | { ok: false; problems: MappingProblem[] }

/**
 * Faire caps product names. Truncating silently would ship a vendor a listing
 * with a cut-off title they never approved, so this is a hard problem rather
 * than a warning — the vendor edits it, we do not guess.
 */
export const FAIRE_MAX_NAME_LENGTH = 255

/** Longer descriptions are accepted but truncated by Faire's own UI. */
export const FAIRE_MAX_DESCRIPTION_LENGTH = 8_000

export const FAIRE_MAX_IMAGES = 12

export type FaireProductPayload = {
  name: string
  description: string
  sku: string
  /** Faire prices in minor units of the listing currency. */
  wholesale_price_cents: number
  retail_price_cents: number
  currency: string
  available_quantity: number
  images: { url: string }[]
  taxonomy_type?: string
  unit_multiplier: number
  active: boolean
}

/**
 * Wholesale is conventionally half of retail on Faire.
 *
 * A default rather than a constant a vendor cannot change: it exists so a
 * product with no explicit wholesale price still maps to something plausible,
 * not because 50% is right for every vendor. `mapProductToFaire` takes an
 * override, and the vendor-rules wholesale engine is the eventual source.
 */
export const DEFAULT_WHOLESALE_RATIO = 0.5

/**
 * Map an FBM product onto a Faire listing.
 *
 * Returns problems instead of throwing so a bulk push can report every bad
 * product at once. A push that dies on the first failure makes a vendor with
 * fifty products fix them one round trip at a time.
 *
 * The cases worth naming:
 *
 * - **No SKU is fatal.** Faire keys updates on it, and pushing without one
 *   creates a duplicate listing on every subsequent sync rather than updating
 *   the original — the single most damaging thing this mapper could do.
 * - **Untracked inventory maps to 0, not to "lots".** `null` here means FBM is
 *   not counting, and telling a wholesale buyer stock exists when nothing is
 *   tracking it produces oversells that land on the vendor.
 * - **A zero or negative price is fatal**, never "free". A misconfigured price
 *   reaching a live wholesale catalogue is a real loss, and it is exactly the
 *   kind of thing an integration is blamed for.
 */
export function mapProductToFaire(
  product: ChannelProduct,
  options: { wholesaleRatio?: number } = {}
): MappingResult<FaireProductPayload> {
  const problems: MappingProblem[] = []
  const warnings: MappingProblem[] = []

  const title = (product.title ?? "").trim()
  if (!title) {
    problems.push({ field: "title", reason: "A product name is required." })
  } else if (title.length > FAIRE_MAX_NAME_LENGTH) {
    problems.push({
      field: "title",
      reason: `Faire allows ${FAIRE_MAX_NAME_LENGTH} characters; this is ${title.length}. Shorten it rather than letting it be cut off.`,
    })
  }

  const sku = (product.sku ?? "").trim()
  if (!sku) {
    problems.push({
      field: "sku",
      reason:
        "Faire matches updates on SKU. Without one, every sync would create a duplicate listing instead of updating this product.",
    })
  }

  if (!Number.isFinite(product.price_amount) || product.price_amount <= 0) {
    problems.push({
      field: "price_amount",
      reason: "A retail price above zero is required before listing.",
    })
  }

  const currency = (product.currency_code ?? "").trim().toUpperCase()
  if (!currency) {
    problems.push({ field: "currency_code", reason: "A currency is required." })
  }

  if (problems.length) return { ok: false, problems }

  const ratio = options.wholesaleRatio ?? DEFAULT_WHOLESALE_RATIO
  // Round rather than floor: flooring every product biases the whole catalogue
  // a cent low, which over a wholesale order of hundreds of units is a real,
  // if small, systematic giveaway.
  const wholesale = Math.max(1, Math.round(product.price_amount * ratio))

  const description = (product.description ?? "").trim()
  if (description.length > FAIRE_MAX_DESCRIPTION_LENGTH) {
    warnings.push({
      field: "description",
      reason: `Faire will truncate this to ${FAIRE_MAX_DESCRIPTION_LENGTH} characters.`,
    })
  }

  if (product.images.length > FAIRE_MAX_IMAGES) {
    warnings.push({
      field: "images",
      reason: `Faire accepts ${FAIRE_MAX_IMAGES} images; the rest will not be sent.`,
    })
  }

  if (product.inventory_quantity === null) {
    warnings.push({
      field: "inventory_quantity",
      reason:
        "This product is not stock-tracked, so it will list as out of stock rather than claim availability nothing is counting.",
    })
  }

  return {
    ok: true,
    warnings,
    value: {
      name: title,
      description: description.slice(0, FAIRE_MAX_DESCRIPTION_LENGTH),
      sku,
      wholesale_price_cents: wholesale,
      retail_price_cents: Math.round(product.price_amount),
      currency,
      available_quantity: Math.max(0, product.inventory_quantity ?? 0),
      images: product.images.slice(0, FAIRE_MAX_IMAGES).map((url) => ({ url })),
      taxonomy_type: product.categories[0],
      unit_multiplier: 1,
      active: product.active,
    },
  }
}

/** Faire's order shape, as much of it as this reads. */
type FaireOrderResponse = {
  id?: string
  created_at?: string
  state?: string
  payout_costs?: {
    payout_fee_cents?: number
    commission_cents?: number
  }
  address?: Record<string, unknown>
  retailer_id?: string
  customer?: { name?: string; email?: string }
  items?: {
    sku?: string
    product_name?: string
    quantity?: number
    price_cents?: number
  }[]
}

/**
 * Map a Faire order into FBM's vocabulary.
 *
 * Returns `null` rather than a partial order when the channel's id is missing:
 * `external_id` is the idempotency key for ingestion, and an order without one
 * would be re-imported on every poll, duplicating a vendor's revenue figures.
 *
 * **The channel's own cut is carried through** (`channel_fee_amount`) rather
 * than dropped. Faire, Etsy and Amazon all take theirs before money reaches
 * the vendor, and an order imported at gross would overstate what the vendor
 * actually earned — the exact reconciliation gap Phase 11 exists to close.
 * Capturing it at ingestion is free; reconstructing it later is not.
 */
export function mapFaireOrder(
  raw: FaireOrderResponse,
  fallbackCurrency = "USD"
): ChannelOrder | null {
  const externalId = (raw.id ?? "").trim()
  if (!externalId) return null

  const items = (raw.items ?? []).map((item) => ({
    sku: item.sku?.trim() || null,
    title: item.product_name ?? "Item",
    quantity: Math.max(0, Math.floor(item.quantity ?? 0)),
    unit_amount: Math.max(0, Math.floor(item.price_cents ?? 0)),
  }))

  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_amount, 0)

  const fees =
    (raw.payout_costs?.payout_fee_cents ?? 0) +
    (raw.payout_costs?.commission_cents ?? 0)

  const placedAt = raw.created_at ? new Date(raw.created_at) : new Date(NaN)

  return {
    external_id: externalId,
    // An unparseable timestamp becomes the epoch rather than an Invalid Date,
    // which would poison every comparison downstream silently.
    placed_at: Number.isNaN(placedAt.getTime()) ? new Date(0) : placedAt,
    currency_code: fallbackCurrency.toUpperCase(),
    total_amount: total,
    buyer_name: raw.customer?.name?.trim() || null,
    buyer_email: raw.customer?.email?.trim() || null,
    shipping_address: raw.address ?? null,
    items,
    channel_fee_amount: fees > 0 ? fees : null,
    raw: raw as Record<string, unknown>,
  }
}
