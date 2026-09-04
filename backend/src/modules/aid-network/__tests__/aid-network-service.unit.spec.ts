import AidNetworkService from "../service"
import { IntakeSource } from "../models/intake-receipt"
import { StockSource, StockStatus } from "../models/node-stock"
import { TransferStatus } from "../models/node-transfer"

/**
 * Service-level cover using the `Object.create(Service.prototype)` +
 * patched-CRUD pattern used elsewhere in the codebase. The allocation itself is
 * covered in `allocation.unit.spec.ts`; what matters here is that intake
 * actually becomes allocatable stock, and that a received transfer moves the
 * right quantities in both directions.
 */

type NodeRow = {
  id: string
  seller_id: string
  slug: string
  name: string
  accepts_intake?: boolean
  accepts_transfers?: boolean
  has_cold_storage?: boolean
  latitude?: number | null
  longitude?: number | null
}

type StockRow = {
  id: string
  seller_id: string
  node_id: string
  item_key: string
  quantity: number
  status?: string
  expires_at?: string | null
  requires_cold?: boolean
}

type TransferRow = {
  id: string
  seller_id: string
  from_node_id: string
  to_node_id: string
  item_key: string
  item_label: string
  status: string
  requested_qty: number
  shipped_qty?: number | null
  source_stock_id?: string | null
  requires_cold?: boolean
  unit_of_measure?: string
}

const NODE_A: NodeRow = {
  id: "n_a",
  seller_id: "sel_1",
  slug: "pantry-a",
  name: "Pantry A",
  accepts_intake: true,
  accepts_transfers: true,
  has_cold_storage: false,
}
const NODE_B: NodeRow = {
  id: "n_b",
  seller_id: "sel_1",
  slug: "pantry-b",
  name: "Pantry B",
  accepts_intake: true,
  accepts_transfers: true,
  has_cold_storage: true,
}

const makeService = (
  nodes: NodeRow[] = [NODE_A, NODE_B],
  stock: StockRow[] = [],
  transfers: TransferRow[] = []
) => {
  const svc = Object.create(AidNetworkService.prototype) as Record<string, unknown>
  const createdStock: Record<string, unknown>[] = []
  const createdReceipts: Record<string, unknown>[] = []
  const createdTransfers: Record<string, unknown>[] = []
  const updatedStock: Record<string, unknown>[] = []
  const updatedTransfers: Record<string, unknown>[] = []

  const match = <T extends Record<string, unknown>>(rows: T[], filter: Record<string, unknown>) =>
    rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v))

  svc.retrieveNetworkNode = (async (id: string) => {
    const found = nodes.find((n) => n.id === id)
    if (!found) throw new Error("not found")
    return found
  }) as unknown
  svc.listNetworkNodes = (async (f: Record<string, unknown> = {}) =>
    match(nodes as unknown as Record<string, unknown>[], f)) as unknown

  svc.retrieveNodeStock = (async (id: string) => {
    const found = stock.find((s) => s.id === id)
    if (!found) throw new Error("not found")
    return found
  }) as unknown
  svc.listNodeStocks = (async (f: Record<string, unknown> = {}) =>
    match(stock as unknown as Record<string, unknown>[], f)) as unknown
  svc.createNodeStocks = (async (data: Record<string, unknown>) => {
    createdStock.push(data)
    return { id: `ns_${createdStock.length}`, ...data }
  }) as unknown
  svc.updateNodeStocks = (async (data: Record<string, unknown>) => {
    updatedStock.push(data)
    return data
  }) as unknown

  svc.createIntakeReceipts = (async (data: Record<string, unknown>) => {
    createdReceipts.push(data)
    return { id: `ir_${createdReceipts.length}`, ...data }
  }) as unknown

  svc.retrieveNodeTransfer = (async (id: string) => {
    const found = transfers.find((t) => t.id === id)
    if (!found) throw new Error("not found")
    return found
  }) as unknown
  svc.createNodeTransfers = (async (data: Record<string, unknown>) => {
    createdTransfers.push(data)
    return { id: `nt_${createdTransfers.length}`, ...data }
  }) as unknown
  svc.updateNodeTransfers = (async (data: Record<string, unknown>) => {
    updatedTransfers.push(data)
    return data
  }) as unknown

  return {
    service: svc as unknown as AidNetworkService,
    createdStock,
    createdReceipts,
    createdTransfers,
    updatedStock,
    updatedTransfers,
  }
}

describe("recordIntake", () => {
  const lines = [
    { item_key: "produce.carrots", item_label: "Carrots", quantity: 40 },
    { item_key: "dairy.milk", item_label: "Milk", quantity: 12, requires_cold: true },
  ]

  it("turns a donation into allocatable stock, not just a receipt", async () => {
    // A receipt with no resulting stock is the failure mode that makes donated
    // goods invisible to allocation — the whole gap this closes.
    const { service, createdStock, createdReceipts } = makeService()

    await service.recordIntake({
      seller_id: "sel_1",
      node_id: "n_a",
      source: IntakeSource.DONATION,
      donor_name: "Corner Market",
      lines,
    })

    expect(createdReceipts).toHaveLength(1)
    expect(createdStock).toHaveLength(2)
    expect(createdStock[0]).toMatchObject({
      node_id: "n_a",
      item_key: "produce.carrots",
      quantity: 40,
      status: StockStatus.AVAILABLE,
    })
  })

  it("links every lot back to the receipt that brought it in", async () => {
    const { service, createdStock } = makeService()
    await service.recordIntake({ seller_id: "sel_1", node_id: "n_a", lines })
    expect(createdStock.every((s) => s.intake_receipt_id === "ir_1")).toBe(true)
  })

  it("stamps the stock source from the kind of intake", async () => {
    const { service, createdStock } = makeService()
    await service.recordIntake({
      seller_id: "sel_1",
      node_id: "n_a",
      source: IntakeSource.GLEANING,
      lines: [lines[0]],
    })
    expect(createdStock[0].source).toBe(StockSource.GLEANED)
  })

  it("records the in-kind valuation and its basis", async () => {
    // The number is only defensible alongside how it was reached.
    const { service, createdReceipts } = makeService()
    await service.recordIntake({
      seller_id: "sel_1",
      node_id: "n_a",
      estimated_value_cents: 12_500,
      valuation_basis: "USDA wholesale, week of 2026-09-01",
      lines: [lines[0]],
    })
    expect(createdReceipts[0]).toMatchObject({
      estimated_value_cents: 12_500,
      valuation_basis: "USDA wholesale, week of 2026-09-01",
    })
  })

  it("refuses another seller's node", async () => {
    const { service } = makeService()
    await expect(
      service.recordIntake({ seller_id: "sel_other", node_id: "n_a", lines })
    ).rejects.toThrow(/not found/i)
  })

  it("refuses a node that does not accept intake", async () => {
    const { service } = makeService([{ ...NODE_A, accepts_intake: false }])
    await expect(
      service.recordIntake({ seller_id: "sel_1", node_id: "n_a", lines })
    ).rejects.toThrow(/does not accept intake/i)
  })

  it("refuses an intake with no lines", async () => {
    const { service } = makeService()
    await expect(
      service.recordIntake({ seller_id: "sel_1", node_id: "n_a", lines: [] })
    ).rejects.toThrow(/at least one intake line/i)
  })
})

describe("planAllocation", () => {
  it("plans only against available stock in the seller's network", async () => {
    const { service } = makeService(
      [NODE_A, NODE_B],
      [
        {
          id: "ns_a",
          seller_id: "sel_1",
          node_id: "n_a",
          item_key: "produce.carrots",
          quantity: 30,
          status: StockStatus.AVAILABLE,
        },
        {
          id: "ns_reserved",
          seller_id: "sel_1",
          node_id: "n_a",
          item_key: "produce.carrots",
          quantity: 999,
          status: StockStatus.RESERVED,
        },
      ]
    )

    const plan = await service.planAllocation("sel_1", [
      {
        demand_id: "d_1",
        node_id: "n_b",
        item_key: "produce.carrots",
        quantity: 50,
      },
    ])

    // Reserved stock is spoken for and must not be planned away.
    expect(plan.allocations).toHaveLength(1)
    expect(plan.allocations[0].quantity).toBe(30)
    expect(plan.unmet[0].quantity).toBe(20)
  })

  it("writes nothing — a plan is a suggestion until a human approves it", async () => {
    const { service, createdTransfers, updatedStock } = makeService(
      [NODE_A, NODE_B],
      [
        {
          id: "ns_a",
          seller_id: "sel_1",
          node_id: "n_a",
          item_key: "produce.carrots",
          quantity: 30,
          status: StockStatus.AVAILABLE,
        },
      ]
    )

    await service.planAllocation("sel_1", [
      { demand_id: "d_1", node_id: "n_b", item_key: "produce.carrots", quantity: 10 },
    ])

    expect(createdTransfers).toEqual([])
    expect(updatedStock).toEqual([])
  })
})

describe("requestTransfer", () => {
  const base = {
    seller_id: "sel_1",
    from_node_id: "n_a",
    to_node_id: "n_b",
    item_key: "produce.carrots",
    item_label: "Carrots",
    requested_qty: 10,
  }

  it("opens a transfer between two hubs", async () => {
    const { service, createdTransfers } = makeService()
    await service.requestTransfer(base)
    expect(createdTransfers[0]).toMatchObject({
      from_node_id: "n_a",
      to_node_id: "n_b",
      status: TransferStatus.REQUESTED,
    })
  })

  it("refuses a transfer to the same node", async () => {
    const { service } = makeService()
    await expect(
      service.requestTransfer({ ...base, to_node_id: "n_a" })
    ).rejects.toThrow(/two different nodes/i)
  })

  it("refuses a non-positive quantity", async () => {
    const { service } = makeService()
    await expect(
      service.requestTransfer({ ...base, requested_qty: 0 })
    ).rejects.toThrow(/greater than zero/i)
  })

  it("refuses a cold transfer to a hub with no cold storage", async () => {
    // Refused at request time, not discovered when the food arrives warm.
    const { service } = makeService()
    await expect(
      service.requestTransfer({
        ...base,
        from_node_id: "n_b",
        to_node_id: "n_a",
        requires_cold: true,
      })
    ).rejects.toThrow(/cold storage/i)
  })

  it("allows a cold transfer to a hub that can hold it", async () => {
    const { service, createdTransfers } = makeService()
    await service.requestTransfer({ ...base, requires_cold: true })
    expect(createdTransfers).toHaveLength(1)
  })

  it("refuses another seller's nodes", async () => {
    const { service } = makeService()
    await expect(
      service.requestTransfer({ ...base, seller_id: "sel_other" })
    ).rejects.toThrow(/not found/i)
  })
})

describe("receiveTransfer", () => {
  const transfer: TransferRow = {
    id: "nt_1",
    seller_id: "sel_1",
    from_node_id: "n_a",
    to_node_id: "n_b",
    item_key: "produce.carrots",
    item_label: "Carrots",
    status: TransferStatus.IN_TRANSIT,
    requested_qty: 20,
    shipped_qty: 20,
    source_stock_id: "ns_a",
    unit_of_measure: "kg",
  }
  const sourceStock: StockRow = {
    id: "ns_a",
    seller_id: "sel_1",
    node_id: "n_a",
    item_key: "produce.carrots",
    quantity: 50,
  }

  it("creates stock at the destination for what actually arrived", async () => {
    const { service, createdStock } = makeService(
      undefined,
      [sourceStock],
      [transfer]
    )
    await service.receiveTransfer("sel_1", "nt_1", 18)

    expect(createdStock[0]).toMatchObject({
      node_id: "n_b",
      item_key: "produce.carrots",
      quantity: 18,
      source: StockSource.TRANSFERRED,
      unit_of_measure: "kg",
    })
  })

  it("draws the origin down by what shipped, not by what arrived", async () => {
    // Food lost in transit has still left the origin shelf; charging the
    // origin only for what arrived would invent stock that is not there.
    const { service, updatedStock } = makeService(undefined, [sourceStock], [transfer])
    await service.receiveTransfer("sel_1", "nt_1", 18)
    expect(updatedStock[0]).toMatchObject({ id: "ns_a", quantity: 30 })
  })

  it("leaves the shortfall visible on the transfer", async () => {
    const { service, updatedTransfers } = makeService(
      undefined,
      [sourceStock],
      [transfer]
    )
    await service.receiveTransfer("sel_1", "nt_1", 18)
    expect(updatedTransfers[0]).toMatchObject({
      status: TransferStatus.RECEIVED,
      received_qty: 18,
      destination_stock_id: "ns_1",
    })
  })

  it("records a total loss without creating empty stock", async () => {
    const { service, createdStock, updatedTransfers } = makeService(
      undefined,
      [sourceStock],
      [transfer]
    )
    await service.receiveTransfer("sel_1", "nt_1", 0)

    expect(createdStock).toEqual([])
    expect(updatedTransfers[0]).toMatchObject({
      received_qty: 0,
      destination_stock_id: null,
    })
  })

  it("never drives origin stock negative", async () => {
    const { service, updatedStock } = makeService(
      undefined,
      [{ ...sourceStock, quantity: 5 }],
      [transfer]
    )
    await service.receiveTransfer("sel_1", "nt_1", 5)
    expect(updatedStock[0]).toMatchObject({ quantity: 0 })
  })

  it("refuses to receive the same transfer twice", async () => {
    const { service } = makeService(
      undefined,
      [sourceStock],
      [{ ...transfer, status: TransferStatus.RECEIVED }]
    )
    await expect(service.receiveTransfer("sel_1", "nt_1", 5)).rejects.toThrow(
      /already been received/i
    )
  })

  it("refuses to receive a cancelled transfer", async () => {
    const { service } = makeService(
      undefined,
      [sourceStock],
      [{ ...transfer, status: TransferStatus.CANCELLED }]
    )
    await expect(service.receiveTransfer("sel_1", "nt_1", 5)).rejects.toThrow(
      /cancelled/i
    )
  })

  it("refuses a negative received quantity", async () => {
    const { service } = makeService(undefined, [sourceStock], [transfer])
    await expect(service.receiveTransfer("sel_1", "nt_1", -1)).rejects.toThrow(
      /must not be negative/i
    )
  })

  it("refuses another seller's transfer", async () => {
    const { service } = makeService(undefined, [sourceStock], [transfer])
    await expect(service.receiveTransfer("sel_other", "nt_1", 5)).rejects.toThrow(
      /not found/i
    )
  })
})
