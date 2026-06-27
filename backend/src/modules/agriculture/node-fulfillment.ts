/**
 * Plant Network — Multi-node fulfillment routing + phyto gating (Section 6).
 *
 * Groups an order's line items by the resolved grower (the product's owning
 * MercurJS `seller_id`, labelled by grower_node), resolves each grower's stock
 * location, and gates dispatch on phytosanitary-cert requirements for live
 * plants shipping into restricted states.
 *
 * The cert-upload URL is generated via the existing MinIO File module
 * (`Modules.FILE` presign). Carrier label purchase is delegated to a
 * provider-agnostic `LabelProvider` (no-op by default) so EasyPost / Shippo /
 * direct USPS can be dropped in without touching this logic.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { emitBlackoutEvent } from "../../lib/blackout-emit"
import {
  loadOrderNodeContext,
  type OrderNodeItem,
} from "./plant-order-helpers"
import { resolveLabelProvider, type LabelResult } from "./label-provider"
import type { GrowerNode } from "../../types/plant"

/** Destination states that restrict live-plant import outright. */
export const RESTRICTED_STATES = ["CA", "AZ", "HI"]
/** States that restrict specific (e.g. citrus) species rather than all plants. */
export const CITRUS_RESTRICTED_STATES = ["TX", "FL"]

/** Minimal item shape needed for phyto classification. */
export interface PhytoItemInput {
  line_item_id: string
  title: string | null
  is_live_plant: boolean
  requires_phyto_cert: boolean
}

/**
 * Pure phyto-restriction classifier (no I/O). Returns the items that need a
 * phytosanitary certificate given the destination state. Extracted for testing.
 */
export function classifyPhytoRestrictions(
  state: string | null,
  items: PhytoItemInput[]
): Array<{ item_id: string; species: string | null; reason: string }> {
  const restricted: Array<{ item_id: string; species: string | null; reason: string }> = []
  if (!state) return restricted

  const fullyRestricted = RESTRICTED_STATES.includes(state)
  const citrusRestricted = CITRUS_RESTRICTED_STATES.includes(state)
  for (const item of items) {
    const live = item.is_live_plant || item.requires_phyto_cert
    if (!live) continue
    if (fullyRestricted) {
      restricted.push({
        item_id: item.line_item_id,
        species: item.title,
        reason: `Live plant into ${state}: state requires phytosanitary certificate`,
      })
    } else if (citrusRestricted && item.requires_phyto_cert) {
      restricted.push({
        item_id: item.line_item_id,
        species: item.title,
        reason: `Restricted species into ${state}: phytosanitary certificate required`,
      })
    }
  }
  return restricted
}

export interface NodeFulfillmentGroup {
  grower_node: GrowerNode | null
  seller_id: string
  stock_location_id: string | null
  line_item_ids: string[]
  items: OrderNodeItem[]
}

export interface PhytoCertCheck {
  required: boolean
  restricted_items: Array<{ item_id: string; species: string | null; reason: string }>
  cert_upload_url: string | null
}

type QueryLike = { graph: (args: Record<string, unknown>) => Promise<{ data: any[] }> }

const normState = (s: string | null): string | null =>
  s ? s.trim().toUpperCase() : null

export class NodeFulfillmentService {
  private readonly container: MedusaContainer

  constructor(container: MedusaContainer) {
    this.container = container
  }

  private get query(): QueryLike {
    return this.container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  }

  /** Resolve a seller's stock location, falling back to the store default. */
  private async resolveStockLocation(sellerId: string): Promise<string | null> {
    // 1. Seller-linked location (runtime remote link).
    try {
      const { data: sellers } = await this.query.graph({
        entity: "seller",
        fields: ["id", "stock_locations.id"],
        filters: { id: sellerId },
      })
      const loc = sellers?.[0]?.stock_locations?.[0]?.id
      if (loc) return loc
    } catch {
      // relation may not be defined; fall through to store default
    }
    // 2. Store default location.
    try {
      const { data: stores } = await this.query.graph({
        entity: "store",
        fields: ["id", "default_location_id"],
      })
      return stores?.[0]?.default_location_id ?? null
    } catch {
      return null
    }
  }

  /**
   * Group order line items by grower (seller_id), one group per grower with
   * items in this order. Items without a resolvable seller are skipped.
   */
  async groupOrderByNode(orderId: string): Promise<NodeFulfillmentGroup[]> {
    const ctx = await loadOrderNodeContext(this.container, orderId)
    if (!ctx) return []

    const bySeller = new Map<string, OrderNodeItem[]>()
    for (const item of ctx.items) {
      if (!item.seller_id) continue
      const list = bySeller.get(item.seller_id) ?? []
      list.push(item)
      bySeller.set(item.seller_id, list)
    }

    const groups: NodeFulfillmentGroup[] = []
    for (const [sellerId, items] of bySeller) {
      const stockLocationId = await this.resolveStockLocation(sellerId)
      groups.push({
        grower_node: items.find((i) => i.grower_node)?.grower_node ?? null,
        seller_id: sellerId,
        stock_location_id: stockLocationId,
        line_item_ids: items.map((i) => i.line_item_id),
        items,
      })
    }
    return groups
  }

  /**
   * Determine whether the order requires a phytosanitary certificate: any live
   * plant (or `requires_phyto_cert` item) shipping into a restricted state.
   */
  async checkPhytoCertRequirement(orderId: string): Promise<PhytoCertCheck> {
    const ctx = await loadOrderNodeContext(this.container, orderId)
    if (!ctx) return { required: false, restricted_items: [], cert_upload_url: null }

    const state = normState(ctx.ship_to_province)
    const restricted = classifyPhytoRestrictions(state, ctx.items)

    return {
      required: restricted.length > 0,
      restricted_items: restricted,
      cert_upload_url: restricted.length > 0 ? await this.presignCertUpload(orderId) : null,
    }
  }

  /**
   * Generate a presigned PUT URL for the cert document via the existing MinIO
   * File module. Returns null when the active file provider doesn't support
   * presign (e.g. the local dev provider) — never throws.
   */
  private async presignCertUpload(orderId: string): Promise<string | null> {
    try {
      const fileService = this.container.resolve(Modules.FILE) as {
        getPresignedUploadUrl?: (d: { filename: string }) => Promise<{ url?: string }>
      }
      if (typeof fileService.getPresignedUploadUrl !== "function") return null
      const result = await fileService.getPresignedUploadUrl({
        filename: `phyto-cert-${orderId}-${Date.now()}.pdf`,
      })
      return result?.url ?? null
    } catch {
      return null
    }
  }

  /**
   * Dispatch fulfillment per grower group. Phyto-gated: if a cert is required it
   * blocks and returns early. Notifies each grower (Blackout). The carrier label
   * purchase + Medusa fulfillment-record creation is the EasyPost SEAM.
   */
  async dispatchFulfillmentsToNodes(
    orderId: string,
    groups?: NodeFulfillmentGroup[]
  ): Promise<{
    dispatched: number
    blocked: boolean
    reason?: string
    labels?: Array<{ seller_id: string; result: LabelResult }>
  }> {
    const phyto = await this.checkPhytoCertRequirement(orderId)
    if (phyto.required) {
      return { dispatched: 0, blocked: true, reason: "phyto_cert_required" }
    }

    const resolved = groups ?? (await this.groupOrderByNode(orderId))
    const labelProvider = resolveLabelProvider(this.container)
    let dispatched = 0
    const labels: Array<{ seller_id: string; result: LabelResult }> = []
    for (const group of resolved) {
      // Purchase the carrier label via the active provider (no-op by default).
      const result = await labelProvider.buyLabel({
        order_id: orderId,
        seller_id: group.seller_id,
        stock_location_id: group.stock_location_id,
        line_item_ids: group.line_item_ids,
      })
      labels.push({ seller_id: group.seller_id, result })

      // Notify the grower a shipment is ready to pack/ship.
      await emitBlackoutEvent(
        this.container,
        "node_fulfillment.dispatched",
        {
          orderId,
          sellerId: group.seller_id,
          growerNode: group.grower_node,
          stockLocationId: group.stock_location_id,
          lineItemIds: group.line_item_ids,
          labelProvider: labelProvider.name,
          trackingNumber: result.tracking_number,
        },
        { eventId: `node_fulfillment.dispatched:${orderId}:${group.seller_id}` }
      )
      dispatched += 1
    }
    return { dispatched, blocked: false, labels }
  }
}
