import { MedusaService } from "@medusajs/framework/utils"
import { ChannelConnection, ChannelListing, ChannelOrderRecord } from "./models"
import type { ChannelOrder } from "./types"
import type { ChannelCredentials } from "./types"

export type ConnectionRow = {
  id: string
  seller_id: string
  channel_id: string
  api_base_url: string
  access_token: string
  options: Record<string, unknown> | null
  enabled: boolean
  orders_synced_through: Date | null
  last_synced_at: Date | null
  last_error: string | null
}

/**
 * Storage for channel connections and the FBM↔channel listing map.
 *
 * Deliberately holds no HTTP: the adapters own transport, `mapping.ts` owns
 * translation, and this owns state. Keeping the three apart is what lets the
 * mapping — the part the roadmap calls the hard problem — be tested without a
 * database or a network.
 */
export type StoredChannelOrder = {
  id: string
  external_id: string
  inventory_applied: boolean
}

class ChannelConnectorService extends MedusaService({
  ChannelConnection,
  ChannelListing,
  ChannelOrderRecord,
}) {
  /** A seller's connections, live ones only. */
  async listForSeller(seller_id: string): Promise<ConnectionRow[]> {
    return (await this.listChannelConnections({
      seller_id,
    })) as unknown as ConnectionRow[]
  }

  async getConnection(
    seller_id: string,
    channel_id: string
  ): Promise<ConnectionRow | null> {
    const rows = (await this.listChannelConnections({
      seller_id,
      channel_id,
    })) as unknown as ConnectionRow[]
    return rows?.[0] ?? null
  }

  /**
   * Create or update a seller's connection to a channel.
   *
   * Upserts rather than erroring on a second connect: re-entering credentials
   * is what a vendor does when a token expires, and making that a conflict
   * would push them toward deleting the connection — which would take the
   * listing map with it and duplicate their whole catalogue on the next push.
   */
  async upsertConnection(input: {
    seller_id: string
    channel_id: string
    api_base_url: string
    access_token: string
    options?: Record<string, unknown> | null
  }): Promise<ConnectionRow> {
    const existing = await this.getConnection(input.seller_id, input.channel_id)

    if (existing) {
      const [updated] = await this.updateChannelConnections([
        {
          id: existing.id,
          api_base_url: input.api_base_url,
          access_token: input.access_token,
          options: input.options ?? null,
          enabled: true,
          // Re-entering credentials clears the stall, but never the cursor —
          // resetting `orders_synced_through` would re-import the vendor's
          // order history.
          last_error: null,
        } as never,
      ])
      return updated as unknown as ConnectionRow
    }

    const [created] = await this.createChannelConnections([
      {
        seller_id: input.seller_id,
        channel_id: input.channel_id,
        api_base_url: input.api_base_url,
        access_token: input.access_token,
        options: input.options ?? null,
        enabled: true,
      } as never,
    ])
    return created as unknown as ConnectionRow
  }

  /** Credentials in the shape the adapters take. */
  toCredentials(row: ConnectionRow): ChannelCredentials {
    return {
      api_base_url: row.api_base_url,
      access_token: row.access_token,
      options: row.options ?? undefined,
    }
  }

  /**
   * Stop syncing without discarding the connection.
   *
   * Distinct from deleting for the reason above: the listing map is what makes
   * resuming safe, and a vendor pausing a channel should not have to rebuild
   * their catalogue to come back.
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.updateChannelConnections({ id, enabled } as never)
  }

  /** The external id for a product on a channel, or null if never pushed. */
  async getListing(
    seller_id: string,
    channel_id: string,
    product_id: string
  ): Promise<{ id: string; external_id: string } | null> {
    const rows = (await this.listChannelListings({
      seller_id,
      channel_id,
      product_id,
    })) as unknown as { id: string; external_id: string }[]
    return rows?.[0] ?? null
  }

  /** Record where a product now lives on a channel. Idempotent per product. */
  async recordListing(input: {
    seller_id: string
    channel_id: string
    product_id: string
    external_id: string
    sku?: string | null
  }): Promise<void> {
    const existing = await this.getListing(
      input.seller_id,
      input.channel_id,
      input.product_id
    )

    if (existing) {
      await this.updateChannelListings({
        id: existing.id,
        external_id: input.external_id,
        sku: input.sku ?? null,
        last_pushed_at: new Date(),
        last_error: null,
      } as never)
      return
    }

    await this.createChannelListings([
      {
        seller_id: input.seller_id,
        channel_id: input.channel_id,
        product_id: input.product_id,
        external_id: input.external_id,
        sku: input.sku ?? null,
        last_pushed_at: new Date(),
      } as never,
    ])
  }

  /** Note why a product could not be listed, without losing its mapping. */
  async recordListingError(
    seller_id: string,
    channel_id: string,
    product_id: string,
    message: string
  ): Promise<void> {
    const existing = await this.getListing(seller_id, channel_id, product_id)
    if (!existing) return
    await this.updateChannelListings({
      id: existing.id,
      last_error: message.slice(0, 1_000),
    } as never)
  }

  /** An already-ingested order, or null. Keyed the way the index is. */
  async findOrder(
    channel_id: string,
    external_id: string
  ): Promise<StoredChannelOrder | null> {
    const rows = (await this.listChannelOrderRecords({
      channel_id,
      external_id,
    })) as unknown as StoredChannelOrder[]
    return rows?.[0] ?? null
  }

  /**
   * Record an order with its stock effect **not yet applied**.
   *
   * Deliberately two steps rather than one: see `decideIngestion` on why
   * recording and decrementing cannot safely be collapsed, and why the flag is
   * what makes a crash between them recoverable in the right direction.
   */
  async recordOrder(input: {
    seller_id: string
    channel_id: string
    order: ChannelOrder
  }): Promise<StoredChannelOrder> {
    const [created] = await this.createChannelOrderRecords([
      {
        seller_id: input.seller_id,
        channel_id: input.channel_id,
        external_id: input.order.external_id,
        placed_at: input.order.placed_at,
        currency_code: input.order.currency_code,
        total_amount: Math.max(0, Math.round(input.order.total_amount)),
        channel_fee_amount:
          input.order.channel_fee_amount === null
            ? null
            : Math.max(0, Math.round(input.order.channel_fee_amount)),
        buyer_name: input.order.buyer_name,
        buyer_email: input.order.buyer_email,
        shipping_address: input.order.shipping_address,
        items: input.order.items,
        inventory_applied: false,
        raw: input.order.raw,
      } as never,
    ])
    return created as unknown as StoredChannelOrder
  }

  /** Stamp an order's stock effect as applied, with what it actually did. */
  async markInventoryApplied(
    id: string,
    report: Record<string, unknown>
  ): Promise<void> {
    await this.updateChannelOrderRecords({
      id,
      inventory_applied: true,
      inventory_report: report,
    } as never)
  }

  /** A seller's ingested channel orders, newest first. */
  async listOrdersForSeller(seller_id: string): Promise<unknown[]> {
    return this.listChannelOrderRecords(
      { seller_id },
      { order: { placed_at: "DESC" }, take: 100 }
    )
  }

  /** Stamp the outcome of a sync run on the connection. */
  async recordSync(input: {
    id: string
    report?: Record<string, unknown>
    orders_synced_through?: Date | null
    error?: string | null
  }): Promise<void> {
    const patch: Record<string, unknown> = {
      id: input.id,
      last_synced_at: new Date(),
      last_error: input.error ? input.error.slice(0, 1_000) : null,
    }
    if (input.report) patch.last_sync_report = input.report
    if (input.orders_synced_through) {
      patch.orders_synced_through = input.orders_synced_through
    }
    await this.updateChannelConnections(patch as never)
  }
}

export default ChannelConnectorService
