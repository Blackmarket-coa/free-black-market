import { mapFaireOrder, mapProductToFaire } from "../mapping"
import {
  ChannelApiError,
  type ChannelAdapter,
  type ChannelCapability,
  type ChannelCredentials,
  type ChannelFulfillment,
  type ChannelInventoryUpdate,
  type ChannelOrder,
  type ChannelProduct,
  type ChannelPushResult,
} from "../types"

/**
 * Faire — the pilot channel.
 *
 * Transport only. Every decision about *what* to send lives in `mapping.ts`,
 * which is pure and tested; this file is the part that cannot be tested
 * without a network, and it is kept deliberately thin for that reason.
 *
 * Copies `supplier-forwarding/adapters/v1-default-adapter.ts` — a class with
 * an `id`, one method per operation, `fetch`, and errors that carry enough to
 * decide whether retrying is sensible.
 *
 * **The wire details below are unverified against a live account.** The
 * endpoint paths, the `X-FAIRE-ACCESS-TOKEN` header and the response field
 * names come from Faire's published external API and have not been exercised
 * with real credentials in this environment. They are isolated in `ENDPOINTS`
 * and in `mapping.ts`'s response type so that correcting them is a small,
 * obvious edit rather than a hunt — and no vendor can reach this code until an
 * operator connects an account, so being wrong here is a setup failure rather
 * than a silent data problem.
 */

const ENDPOINTS = {
  products: "/products",
  productBySku: (sku: string) => `/products/by-sku/${encodeURIComponent(sku)}`,
  inventory: "/inventories",
  orders: "/orders",
  shipments: (orderId: string) => `/orders/${encodeURIComponent(orderId)}/shipments`,
} as const

const REQUEST_TIMEOUT_MS = 15_000

export class FaireChannelAdapter implements ChannelAdapter {
  readonly id = "faire"
  readonly capabilities: readonly ChannelCapability[] = [
    "push_listing",
    "push_inventory",
    "pull_orders",
    "push_fulfillment",
  ]

  supports(capability: ChannelCapability): boolean {
    return this.capabilities.includes(capability)
  }

  private async request<T>(
    credentials: ChannelCredentials,
    path: string,
    init: { method: string; body?: unknown; query?: Record<string, string> }
  ): Promise<T> {
    const base = credentials.api_base_url.replace(/\/$/, "")
    const url = new URL(`${base}${path}`)
    for (const [k, v] of Object.entries(init.query ?? {})) {
      url.searchParams.set(k, v)
    }

    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          "X-FAIRE-ACCESS-TOKEN": credentials.access_token,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      // Status 0 marks "never reached the channel" — retryable, and distinct
      // from a channel that answered and said no.
      throw new ChannelApiError(
        `Faire request failed: ${err instanceof Error ? err.message : "unknown"}`,
        0,
        this.id
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new ChannelApiError(
        `Faire returned ${response.status} for ${init.method} ${path}`,
        response.status,
        this.id,
        body.slice(0, 2_000)
      )
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  /**
   * Create or update one listing.
   *
   * Takes `externalId` so a re-push is an update. Without it Faire would key
   * only on SKU, and the first product a vendor renamed would appear twice in
   * their wholesale catalogue.
   */
  async pushListing(
    product: ChannelProduct,
    credentials: ChannelCredentials,
    externalId?: string | null
  ): Promise<ChannelPushResult> {
    const mapped = mapProductToFaire(product)
    if (!mapped.ok) {
      // A mapping problem will fail identically forever, so it is reported as
      // a 422 — non-retryable by `ChannelApiError.retryable` — rather than
      // being retried by the job machinery until it gives up.
      throw new ChannelApiError(
        `Cannot list "${product.title}": ${mapped.problems
          .map((p) => `${p.field}: ${p.reason}`)
          .join(" ")}`,
        422,
        this.id
      )
    }

    const isUpdate = Boolean(externalId)
    const body = await this.request<{ id?: string }>(
      credentials,
      isUpdate ? `${ENDPOINTS.products}/${externalId}` : ENDPOINTS.products,
      { method: isUpdate ? "PATCH" : "POST", body: mapped.value }
    )

    return {
      external_id: body?.id ?? externalId ?? null,
      created: !isUpdate,
    }
  }

  /**
   * Push stock levels.
   *
   * Sent one at a time rather than as a batch: a batch that fails tells the
   * vendor nothing about which SKU was wrong, and stock accuracy is the thing
   * a wholesale buyer notices first. An individual failure is counted and the
   * rest of the batch continues — one bad SKU must not freeze a catalogue's
   * stock, which is how oversells start.
   */
  async pushInventory(
    updates: ChannelInventoryUpdate[],
    credentials: ChannelCredentials
  ): Promise<{ updated: number }> {
    let updated = 0
    for (const update of updates) {
      try {
        await this.request(credentials, ENDPOINTS.inventory, {
          method: "PATCH",
          body: {
            sku: update.sku,
            available_quantity: Math.max(0, Math.floor(update.quantity)),
          },
        })
        updated++
      } catch (err) {
        // Rethrow only what retrying could fix; a rejected SKU is skipped so
        // the remaining stock levels still land.
        if (err instanceof ChannelApiError && err.retryable) throw err
      }
    }
    return { updated }
  }

  /**
   * Read orders placed since a cursor.
   *
   * The caller supplies the cursor rather than the adapter tracking one: the
   * connection row is where "how far have we read" belongs, so a redeploy or a
   * second worker cannot lose or double-count it.
   */
  async pullOrders(
    since: Date,
    credentials: ChannelCredentials
  ): Promise<ChannelOrder[]> {
    const body = await this.request<{ orders?: unknown[] }>(
      credentials,
      ENDPOINTS.orders,
      {
        method: "GET",
        query: { updated_at_min: since.toISOString(), limit: "50" },
      }
    )

    // A malformed order is dropped, not allowed to abort the whole poll — one
    // unparseable record must not stop a vendor's other orders arriving.
    return (body?.orders ?? [])
      .map((raw) => mapFaireOrder(raw as Record<string, never>))
      .filter((order): order is ChannelOrder => order !== null)
  }

  /**
   * Report a shipment back to the channel.
   *
   * Worth doing rather than skipping: a marketplace that never sees tracking
   * treats the order as unfulfilled, and Amazon and Etsy both penalise the
   * seller account for it. Faire is gentler, but a buyer with no tracking
   * still opens a ticket the vendor has to answer.
   *
   * Errors propagate. Unlike the inventory push there is no partial success to
   * salvage — one shipment either reached the channel or did not, and the
   * caller needs to know which so it can retry a transport failure and stop on
   * a rejection.
   */
  async pushFulfillment(
    fulfillment: ChannelFulfillment,
    credentials: ChannelCredentials
  ): Promise<void> {
    await this.request(
      credentials,
      ENDPOINTS.shipments(fulfillment.external_order_id),
      {
        method: "POST",
        body: {
          // A missing carrier is sent as null rather than an invented default:
          // guessing puts a wrong courier in front of the buyer.
          carrier: fulfillment.carrier ?? null,
          tracking_code: fulfillment.tracking_number ?? null,
          ship_date: fulfillment.shipped_at.toISOString(),
        },
      }
    )
  }
}

export const faireAdapter = new FaireChannelAdapter()
