/**
 * The contract every outbound sales channel implements.
 *
 * Phase 9. Outbound push is not greenfield here — `printful-fulfillment`
 * authenticates and POSTs, `supplier-forwarding/adapters/` already has the
 * registry-plus-retry-job shape this copies, and `api/product-feed/` emits a
 * pull-based feed. What none of them do is **per-vendor authenticated listing
 * and inventory push, order ingestion, and schema translation**, which is what
 * this adds.
 *
 * The first adapter defines the interface every later channel inherits, so the
 * shape below is deliberately conservative about what it assumes:
 *
 * - **Capabilities are declared, not assumed.** Etsy, Amazon and Faire do not
 *   support the same operations, and an interface where every channel must
 *   implement every method forces the ones that cannot into throwing stubs —
 *   which turns "this channel does not do that" into a runtime error rather
 *   than a fact the UI can read ahead of time.
 * - **Every operation is per-seller.** A channel connection belongs to a
 *   vendor, not to the platform; the credentials, the catalogue and the orders
 *   are all theirs.
 * - **Translation is separate from transport.** The mapping between FBM's
 *   product shape and a channel's lives in a pure module (`mapping.ts`) rather
 *   than inside the HTTP client. The roadmap is explicit that schema
 *   translation is the hard part and the HTTP is not, and a mapper welded to a
 *   fetch call cannot be tested without one.
 */

/** What an adapter is able to do. Read before calling, never assumed. */
export type ChannelCapability =
  /** Push a product to the channel's catalogue. */
  | "push_listing"
  /** Update stock levels for already-listed products. */
  | "push_inventory"
  /** Read orders the channel captured on the vendor's behalf. */
  | "pull_orders"
  /** Report shipment and tracking back to the channel. */
  | "push_fulfillment"

export const CHANNEL_CAPABILITIES: readonly ChannelCapability[] = [
  "push_listing",
  "push_inventory",
  "pull_orders",
  "push_fulfillment",
] as const

/**
 * An FBM product, reduced to what any channel could plausibly need.
 *
 * Deliberately not Medusa's `ProductDTO`: an adapter that took the full entity
 * would couple every channel to Medusa's schema and to whatever `query.graph`
 * happened to select at the call site. This is the narrow contract the mapper
 * translates *from*.
 */
export type ChannelProduct = {
  id: string
  title: string
  description: string | null
  /** Vendor's own SKU. Channels key on this for updates. */
  sku: string | null
  /** Minor units, in `currency_code`. */
  price_amount: number
  currency_code: string
  /** Units on hand. `null` when the product is not stock-tracked. */
  inventory_quantity: number | null
  images: string[]
  /** Free-form vendor taxonomy; each channel maps it to its own. */
  categories: string[]
  /** Per-unit weight in grams, when known. Several channels require it. */
  weight_grams: number | null
  active: boolean
}

/** A stock movement to report outward. */
export type ChannelInventoryUpdate = {
  sku: string
  quantity: number
}

/** An order pulled from a channel, in FBM's vocabulary. */
export type ChannelOrder = {
  /** The channel's own id. The idempotency key for ingestion. */
  external_id: string
  placed_at: Date
  currency_code: string
  /** Minor units. */
  total_amount: number
  buyer_name: string | null
  buyer_email: string | null
  shipping_address: Record<string, unknown> | null
  items: {
    sku: string | null
    title: string
    quantity: number
    unit_amount: number
  }[]
  /** The channel's own cut, in minor units, when it reports one. */
  channel_fee_amount: number | null
  raw: Record<string, unknown>
}

/** Shipment details to report back. Several channels penalise not doing so. */
export type ChannelFulfillment = {
  external_order_id: string
  carrier: string | null
  tracking_number: string | null
  shipped_at: Date
}

/** Credentials and endpoint for one vendor's connection to one channel. */
export type ChannelCredentials = {
  /** Overridable so a sandbox can be pointed at without a code change. */
  api_base_url: string
  access_token: string
  /** Channel-specific extras (a shop id, a region). */
  options?: Record<string, unknown>
}

/**
 * The result of a push.
 *
 * Carries `external_id` because the next push for the same product is an
 * update rather than a create, and the channel's id is the only thing that
 * makes that distinction reliably — matching on SKU alone silently creates
 * duplicates the first time a vendor edits one.
 */
export type ChannelPushResult = {
  external_id: string | null
  /** True when the channel reported it created rather than updated. */
  created: boolean
}

export interface ChannelAdapter {
  /** Stable key. Matches the catalogue entry and the stored connection. */
  readonly id: string
  readonly capabilities: readonly ChannelCapability[]

  supports(capability: ChannelCapability): boolean

  pushListing?(
    product: ChannelProduct,
    credentials: ChannelCredentials,
    externalId?: string | null
  ): Promise<ChannelPushResult>

  pushInventory?(
    updates: ChannelInventoryUpdate[],
    credentials: ChannelCredentials
  ): Promise<{ updated: number }>

  pullOrders?(
    since: Date,
    credentials: ChannelCredentials
  ): Promise<ChannelOrder[]>

  pushFulfillment?(
    fulfillment: ChannelFulfillment,
    credentials: ChannelCredentials
  ): Promise<void>
}

/**
 * Raised when a channel rejects a request.
 *
 * Distinguishes a rejection from a transport failure because the two need
 * opposite handling: a 422 on a malformed listing will fail identically
 * forever and should stop, while a 502 should be retried by the same job
 * machinery `supplier-forwarding` already uses.
 */
export class ChannelApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly channelId: string,
    readonly body?: string,
    /**
     * Seconds the channel asked us to wait, parsed from `Retry-After`.
     *
     * Carried on the error rather than left in the response because this is the
     * only place the header can survive: the response object does not escape the
     * adapter, and by the time a job decides how long to back off, an unrecorded
     * header is indistinguishable from one that was never sent. Losing it means
     * silently substituting our own guess for a duration the channel named,
     * which is how a throttle becomes a suspension.
     */
    readonly retryAfterSeconds?: number | null
  ) {
    super(message)
    this.name = "ChannelApiError"
  }

  /** Worth retrying: transport, rate limit, or the channel's own fault. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0
  }
}
