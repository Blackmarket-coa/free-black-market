import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import { IntakeReceipt, NetworkNode, NodeStock, NodeTransfer } from "./models"
import { StockSource, StockStatus } from "./models/node-stock"
import { IntakeSource, DonorType } from "./models/intake-receipt"
import { TransferReason, TransferStatus } from "./models/node-transfer"
import {
  allocateAcrossNodes,
  findExpiringSurplus,
  type AllocationOptions,
  type AllocationPlan,
  type DemandRequest,
} from "./allocation"

/** One lot arriving as part of an intake. */
export interface IntakeLineInput {
  item_key: string
  item_label: string
  quantity: number
  unit_of_measure?: string
  lot_code?: string | null
  expires_at?: Date | string | null
  requires_cold?: boolean
  metadata?: Record<string, unknown> | null
}

export interface RecordIntakeInput {
  seller_id: string
  node_id: string
  source?: IntakeSource
  donor_name?: string | null
  donor_type?: DonorType
  donor_contact?: string | null
  received_at?: Date | string
  received_by?: string | null
  estimated_value_cents?: number | null
  valuation_basis?: string | null
  currency_code?: string
  fund_id?: string | null
  notes?: string | null
  metadata?: Record<string, unknown> | null
  lines: IntakeLineInput[]
}

/** Source of an intake mapped to the source stamped on the stock it creates. */
const INTAKE_TO_STOCK_SOURCE: Record<string, StockSource> = {
  [IntakeSource.DONATION]: StockSource.DONATED,
  [IntakeSource.RESCUE]: StockSource.RESCUED,
  [IntakeSource.GLEANING]: StockSource.GLEANED,
  [IntakeSource.OVERPRODUCTION]: StockSource.PRODUCED,
  [IntakeSource.TRANSFER_IN]: StockSource.TRANSFERRED,
}

/**
 * Aid Network service.
 *
 * Owns the hubs a distribution network is made of, the stock sitting at each,
 * how non-purchased goods get in, and how stock moves between them.
 *
 * The allocation itself is pure (`allocation.ts`) and this service only feeds it
 * real rows, so the planning logic can be tested exhaustively without a database
 * and a suggested plan can be re-run and diffed.
 */
class AidNetworkModuleService extends MedusaService({
  NetworkNode,
  NodeStock,
  IntakeReceipt,
  NodeTransfer,
}) {
  async listNodesForSeller(sellerId: string) {
    return this.listNetworkNodes({ seller_id: sellerId })
  }

  async listStockForNode(sellerId: string, nodeId: string) {
    return this.listNodeStocks({ seller_id: sellerId, node_id: nodeId })
  }

  /** Every available lot across the seller's network. */
  async listAvailableStock(sellerId: string) {
    return this.listNodeStocks({
      seller_id: sellerId,
      status: StockStatus.AVAILABLE,
    })
  }

  /**
   * Records an intake and the stock it produced, in one call.
   *
   * Intake and inventory are written together deliberately: a receipt with no
   * resulting stock is the failure mode that makes donated goods invisible to
   * allocation, which is the entire gap this closes.
   */
  async recordIntake(input: RecordIntakeInput) {
    const node = await this.retrieveNetworkNode(input.node_id).catch(() => null)
    if (!node || node.seller_id !== input.seller_id) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Node not found")
    }
    if (!node.accepts_intake) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This node does not accept intake"
      )
    }
    if (!input.lines?.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "At least one intake line is required"
      )
    }

    const source = input.source ?? IntakeSource.DONATION
    const received_at = input.received_at ? new Date(input.received_at) : new Date()

    const receipt = await this.createIntakeReceipts({
      seller_id: input.seller_id,
      node_id: input.node_id,
      source,
      donor_name: input.donor_name ?? null,
      donor_type: input.donor_type ?? DonorType.INDIVIDUAL,
      donor_contact: input.donor_contact ?? null,
      received_at,
      received_by: input.received_by ?? null,
      estimated_value_cents:
        input.estimated_value_cents === null ||
        input.estimated_value_cents === undefined
          ? null
          : Math.round(input.estimated_value_cents),
      valuation_basis: input.valuation_basis ?? null,
      currency_code: input.currency_code ?? "usd",
      fund_id: input.fund_id ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? null,
    })

    const receiptId = Array.isArray(receipt) ? receipt[0]?.id : receipt?.id
    const stockSource = INTAKE_TO_STOCK_SOURCE[source] ?? StockSource.DONATED

    const stock = await Promise.all(
      input.lines.map((line) =>
        this.createNodeStocks({
          seller_id: input.seller_id,
          node_id: input.node_id,
          item_key: line.item_key,
          item_label: line.item_label,
          unit_of_measure: line.unit_of_measure ?? "each",
          quantity: line.quantity,
          lot_code: line.lot_code ?? null,
          expires_at: line.expires_at ? new Date(line.expires_at) : null,
          requires_cold: line.requires_cold ?? false,
          source: stockSource,
          status: StockStatus.AVAILABLE,
          intake_receipt_id: receiptId ?? null,
          metadata: line.metadata ?? null,
        })
      )
    )

    return { intake_receipt: receipt, node_stock: stock.flat() }
  }

  /**
   * Plans which stock should move where to satisfy the given demands.
   *
   * Returns suggestions only — nothing is written. A plan a human has not
   * approved should never silently move a network's food, and keeping the
   * planner read-only is what lets it be re-run freely.
   */
  async planAllocation(
    sellerId: string,
    demands: DemandRequest[],
    options: AllocationOptions = {}
  ): Promise<AllocationPlan> {
    const [nodes, stock] = await Promise.all([
      this.listNetworkNodes({ seller_id: sellerId }),
      this.listAvailableStock(sellerId),
    ])

    // `accepts_transfers` is enforced inside the planner, not by dropping stock
    // here: a hub that keeps its stock for itself must still be able to serve
    // its own demand from it.
    return allocateAcrossNodes(
      demands,
      stock
        .map((s) => ({
          stock_id: s.id,
          node_id: s.node_id,
          item_key: s.item_key,
          quantity: Number(s.quantity ?? 0),
          expires_at: s.expires_at ?? null,
          requires_cold: s.requires_cold ?? false,
        })),
      nodes.map((n) => ({
        node_id: n.id,
        latitude: n.latitude ?? null,
        longitude: n.longitude ?? null,
        has_cold_storage: n.has_cold_storage ?? false,
        accepts_transfers: n.accepts_transfers ?? true,
      })),
      options
    )
  }

  /**
   * Surplus that will spoil within `withinDays` — the reverse-logistics feed.
   * Computed against demand so that stock already spoken for is not offered up
   * for redistribution.
   */
  async findSurplusToRedistribute(
    sellerId: string,
    demands: DemandRequest[] = [],
    withinDays = 3,
    now: Date | string = new Date()
  ) {
    const stock = await this.listAvailableStock(sellerId)
    const supplies = stock.map((s) => ({
      stock_id: s.id,
      node_id: s.node_id,
      item_key: s.item_key,
      quantity: Number(s.quantity ?? 0),
      expires_at: s.expires_at ?? null,
      requires_cold: s.requires_cold ?? false,
    }))

    const plan = await this.planAllocation(sellerId, demands, { now })
    return findExpiringSurplus(plan.leftover, supplies, withinDays, now)
  }

  /** Opens a transfer between two hubs the seller owns. */
  async requestTransfer(input: {
    seller_id: string
    from_node_id: string
    to_node_id: string
    item_key: string
    item_label: string
    requested_qty: number
    unit_of_measure?: string
    reason?: TransferReason
    source_stock_id?: string | null
    requires_cold?: boolean
    courier_id?: string | null
    expected_at?: Date | string | null
    notes?: string | null
  }) {
    if (input.from_node_id === input.to_node_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A transfer must move between two different nodes"
      )
    }
    if (!(input.requested_qty > 0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "requested_qty must be greater than zero"
      )
    }

    const [from, to] = await Promise.all([
      this.retrieveNetworkNode(input.from_node_id).catch(() => null),
      this.retrieveNetworkNode(input.to_node_id).catch(() => null),
    ])
    for (const node of [from, to]) {
      if (!node || node.seller_id !== input.seller_id) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "Node not found")
      }
    }

    // Cold chain is refused at request time, not discovered on arrival.
    if (input.requires_cold && to?.has_cold_storage !== true) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Destination node has no cold storage for a cold-chain transfer"
      )
    }

    return this.createNodeTransfers({
      seller_id: input.seller_id,
      from_node_id: input.from_node_id,
      to_node_id: input.to_node_id,
      item_key: input.item_key,
      item_label: input.item_label,
      unit_of_measure: input.unit_of_measure ?? "each",
      reason: input.reason ?? TransferReason.REBALANCE,
      status: TransferStatus.REQUESTED,
      requested_qty: input.requested_qty,
      source_stock_id: input.source_stock_id ?? null,
      requires_cold: input.requires_cold ?? false,
      courier_id: input.courier_id ?? null,
      expected_at: input.expected_at ? new Date(input.expected_at) : null,
      notes: input.notes ?? null,
    })
  }

  /**
   * Books a transfer as received, moving the quantity that actually arrived
   * into stock at the destination and drawing it down at the origin.
   *
   * `received_qty` is what arrived, which may be less than what shipped. The
   * shortfall is left visible on the transfer rather than reconciled away — it
   * is the shrinkage signal that tells a network which route is losing food.
   */
  async receiveTransfer(
    sellerId: string,
    transferId: string,
    receivedQty: number,
    opts: { expires_at?: Date | string | null; lot_code?: string | null } = {}
  ) {
    const transfer = await this.retrieveNodeTransfer(transferId).catch(() => null)
    if (!transfer || transfer.seller_id !== sellerId) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Transfer not found")
    }
    if (transfer.status === TransferStatus.RECEIVED) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Transfer has already been received"
      )
    }
    if (transfer.status === TransferStatus.CANCELLED) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot receive a cancelled transfer"
      )
    }
    if (!(receivedQty >= 0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "received_qty must not be negative"
      )
    }

    // Draw down the origin lot by what was shipped, not by what arrived: stock
    // lost in transit has still left the origin shelf.
    const drawdown = Number(transfer.shipped_qty ?? transfer.requested_qty ?? 0)
    if (transfer.source_stock_id && drawdown > 0) {
      const source = await this.retrieveNodeStock(transfer.source_stock_id).catch(
        () => null
      )
      if (source) {
        await this.updateNodeStocks({
          id: source.id,
          quantity: Math.max(0, Number(source.quantity ?? 0) - drawdown),
        })
      }
    }

    let destinationStockId: string | null = null
    if (receivedQty > 0) {
      const created = await this.createNodeStocks({
        seller_id: sellerId,
        node_id: transfer.to_node_id,
        item_key: transfer.item_key,
        item_label: transfer.item_label,
        unit_of_measure: transfer.unit_of_measure ?? "each",
        quantity: receivedQty,
        lot_code: opts.lot_code ?? null,
        expires_at: opts.expires_at ? new Date(opts.expires_at) : null,
        requires_cold: transfer.requires_cold ?? false,
        source: StockSource.TRANSFERRED,
        status: StockStatus.AVAILABLE,
      })
      destinationStockId = Array.isArray(created) ? created[0]?.id : created?.id
    }

    return this.updateNodeTransfers({
      id: transferId,
      status: TransferStatus.RECEIVED,
      received_qty: receivedQty,
      destination_stock_id: destinationStockId,
      completed_at: new Date(),
    })
  }
}

export default AidNetworkModuleService
