/**
 * Plant Network — Multi-node fulfillment routing + phyto gating (Section 6).
 *
 * Current state: the repo provisions a single default stock location
 * (`loaders/init-stock-location.ts`, `scripts/setup-stock-location.ts`,
 * store.default_location_id) and has fulfillment providers
 * (`modules/blackstar-fulfillment*`, `modules/local-delivery-fulfillment`,
 * `modules/printful-fulfillment`). There is NO logic to split an order across
 * multiple grower nodes or to gate live-plant shipments on phytosanitary certs.
 *
 * This stub adds node routing. Each GrowerNode maps to a MedusaJS stock location;
 * provision one location per node (extend `init-stock-location.ts`) and fill the
 * map below with the real location ids. Dispatch should create one fulfillment per
 * node via the standard fulfillment workflow, not a bespoke shipper.
 */

import type { GrowerNode } from "../../types/plant"

export interface NodeFulfillmentGroup {
  grower_node: GrowerNode
  stock_location_id: string
  line_item_ids: string[]
  grower_email?: string // label recipient
  grower_blackout_id?: string // Matrix id for Blackout notification
}

export interface PhytoCertCheck {
  required: boolean
  restricted_items: Array<{ item_id: string; species: string; reason: string }>
  cert_upload_url?: string // pre-signed upload URL for the cert document
}

/** Destination states that restrict live-plant import outright. */
export const RESTRICTED_STATES = ["CA", "AZ", "HI"] as const
/** States that restrict specific (e.g. citrus) species rather than all plants. */
export const CITRUS_RESTRICTED_STATES = ["TX", "FL"] as const

export class NodeFulfillmentService {
  /**
   * Stock-location id per node. TODO: populate after creating one stock location
   * per node in MedusaJS admin / `init-stock-location.ts`.
   */
  private readonly NODE_LOCATION_MAP: Record<GrowerNode, string> = {
    hub_sc: "loc_TODO_hub_sc",
    node_ga: "loc_TODO_node_ga",
    node_fl: "loc_TODO_node_fl",
    node_nc_mtn: "loc_TODO_node_nc_mtn",
    node_nc_pied: "loc_TODO_node_nc_pied",
    node_va: "loc_TODO_node_va",
    node_md: "loc_TODO_node_md",
    node_ny: "loc_TODO_node_ny",
  }

  /**
   * TODO: Group an order's line items by `product.metadata.grower_node`, resolve
   * each node's stock location via NODE_LOCATION_MAP and grower contact via the
   * producer module. Returns one group per node represented in the order.
   */
  async groupOrderByNode(_orderId: string): Promise<NodeFulfillmentGroup[]> {
    throw new Error("TODO: NodeFulfillmentService.groupOrderByNode not implemented")
  }

  /**
   * TODO: For each group, create a MedusaJS fulfillment scoped to that stock
   * location (standard fulfillment workflow), generate the shipping label
   * (EasyPost), email label + packing slip to the grower, and emit a Blackout
   * Matrix notification (reuse `subscribers/emit-blackout-*`).
   */
  async dispatchFulfillmentsToNodes(
    _orderId: string,
    _groups: NodeFulfillmentGroup[]
  ): Promise<void> {
    throw new Error(
      "TODO: NodeFulfillmentService.dispatchFulfillmentsToNodes not implemented"
    )
  }

  /**
   * TODO: If the destination state restricts any live plant in the order, block
   * dispatch until a phyto cert is uploaded. Use RESTRICTED_STATES (all live
   * plants) and CITRUS_RESTRICTED_STATES (citrus-specific) plus each product's
   * `requires_phyto_cert` flag.
   */
  async checkPhytoCertRequirement(_orderId: string): Promise<PhytoCertCheck> {
    throw new Error(
      "TODO: NodeFulfillmentService.checkPhytoCertRequirement not implemented"
    )
  }
}
