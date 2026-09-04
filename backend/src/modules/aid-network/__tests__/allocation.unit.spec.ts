import {
  allocateAcrossNodes,
  compareByExpiry,
  findExpiringSurplus,
  haversineKm,
  type AllocationNode,
  type DemandRequest,
  type SupplyLot,
} from "../allocation"

/**
 * The allocation engine decides where a network's food goes, so it is covered
 * purely and hard. The cases that matter are the ones that waste food or break
 * a cold chain: stale lots, lots that spoil before they are needed, cold items
 * sent to hubs that cannot hold them, and scarce stock going to the wrong hub.
 */

const NOW = "2026-09-04T00:00:00Z"
const inDays = (n: number) =>
  new Date(Date.parse(NOW) + n * 86_400_000).toISOString()

// Roughly Philadelphia, Camden (~5km), and Pittsburgh (~500km).
const PHILLY: AllocationNode = { node_id: "n_philly", latitude: 39.95, longitude: -75.16 }
const CAMDEN: AllocationNode = { node_id: "n_camden", latitude: 39.94, longitude: -75.12 }
const PITT: AllocationNode = { node_id: "n_pitt", latitude: 40.44, longitude: -79.99 }

const lot = (over: Partial<SupplyLot> = {}): SupplyLot => ({
  stock_id: "st_1",
  node_id: "n_philly",
  item_key: "produce.carrots",
  quantity: 10,
  expires_at: null,
  requires_cold: false,
  ...over,
})

const need = (over: Partial<DemandRequest> = {}): DemandRequest => ({
  demand_id: "d_1",
  node_id: "n_camden",
  item_key: "produce.carrots",
  quantity: 10,
  needed_by: null,
  ...over,
})

describe("haversineKm", () => {
  it("measures a short hop", () => {
    const d = haversineKm(PHILLY, CAMDEN)
    expect(d).not.toBeNull()
    expect(d as number).toBeGreaterThan(1)
    expect(d as number).toBeLessThan(10)
  })

  it("measures a long hop", () => {
    expect(haversineKm(PHILLY, PITT) as number).toBeGreaterThan(400)
  })

  it("is zero between a node and itself", () => {
    expect(haversineKm(PHILLY, PHILLY)).toBeCloseTo(0, 6)
  })

  it("returns null when either node lacks coordinates", () => {
    expect(haversineKm(PHILLY, { node_id: "n_x" })).toBeNull()
    expect(haversineKm(null, PHILLY)).toBeNull()
  })
})

describe("compareByExpiry", () => {
  it("sorts the soonest expiry first", () => {
    const sorted = [
      { expires_at: inDays(5) },
      { expires_at: inDays(1) },
      { expires_at: inDays(3) },
    ].sort(compareByExpiry)
    expect(sorted[0].expires_at).toBe(inDays(1))
  })

  it("sorts undated stock last, since it has no urgency", () => {
    const sorted = [{ expires_at: null }, { expires_at: inDays(9) }].sort(
      compareByExpiry
    )
    expect(sorted[0].expires_at).toBe(inDays(9))
  })
})

describe("allocateAcrossNodes", () => {
  const nodes = [PHILLY, CAMDEN, PITT]

  it("fills a demand from a single lot", () => {
    const plan = allocateAcrossNodes([need()], [lot()], nodes, { now: NOW })

    expect(plan.unmet).toEqual([])
    expect(plan.allocations).toHaveLength(1)
    expect(plan.allocations[0]).toMatchObject({
      from_node_id: "n_philly",
      to_node_id: "n_camden",
      quantity: 10,
      is_local: false,
    })
  })

  it("splits a demand across lots when no single lot covers it", () => {
    const plan = allocateAcrossNodes(
      [need({ quantity: 15 })],
      [
        lot({ stock_id: "st_a", quantity: 10 }),
        lot({ stock_id: "st_b", quantity: 10 }),
      ],
      nodes,
      { now: NOW }
    )

    expect(plan.allocations.reduce((s, a) => s + a.quantity, 0)).toBe(15)
    expect(plan.unmet).toEqual([])
    expect(plan.leftover.find((l) => l.stock_id === "st_b")?.quantity).toBe(5)
  })

  it("reports the shortfall when the network does not have enough", () => {
    const plan = allocateAcrossNodes(
      [need({ quantity: 25 })],
      [lot({ quantity: 10 })],
      nodes,
      { now: NOW }
    )

    expect(plan.allocations[0].quantity).toBe(10)
    expect(plan.unmet).toEqual([
      {
        demand_id: "d_1",
        node_id: "n_camden",
        item_key: "produce.carrots",
        quantity: 15,
        reason: "no_supply",
      },
    ])
  })

  it("never allocates a lot that has already expired", () => {
    const plan = allocateAcrossNodes(
      [need()],
      [lot({ expires_at: inDays(-1) })],
      nodes,
      { now: NOW }
    )

    expect(plan.allocations).toEqual([])
    expect(plan.unmet[0].reason).toBe("no_supply")
    // Spoiled stock is not inventory, so it is not leftover either.
    expect(plan.leftover).toEqual([])
  })

  it("skips a lot that spoils before it is needed", () => {
    const plan = allocateAcrossNodes(
      [need({ needed_by: inDays(5) })],
      [lot({ expires_at: inDays(2) })],
      nodes,
      { now: NOW }
    )

    expect(plan.allocations).toEqual([])
    expect(plan.unmet[0].reason).toBe("expires_before_needed")
  })

  it("does not send a cold item to a hub that cannot hold it", () => {
    const plan = allocateAcrossNodes(
      [need()],
      [lot({ requires_cold: true })],
      [PHILLY, { ...CAMDEN, has_cold_storage: false }],
      { now: NOW }
    )

    expect(plan.allocations).toEqual([])
    // The distinction matters: "we have it but cannot keep it cold" is fixed by
    // buying a fridge, not by sourcing more food.
    expect(plan.unmet[0].reason).toBe("cold_chain_unavailable")
  })

  it("sends a cold item to a hub that can hold it", () => {
    const plan = allocateAcrossNodes(
      [need()],
      [lot({ requires_cold: true })],
      [PHILLY, { ...CAMDEN, has_cold_storage: true }],
      { now: NOW }
    )
    expect(plan.allocations).toHaveLength(1)
  })

  it("lets a hub use its own cold stock without a cold-storage flag", () => {
    // It is already being held there; re-testing it would strand real stock.
    const plan = allocateAcrossNodes(
      [need({ node_id: "n_philly" })],
      [lot({ node_id: "n_philly", requires_cold: true })],
      [{ ...PHILLY, has_cold_storage: false }],
      { now: NOW }
    )
    expect(plan.allocations[0].is_local).toBe(true)
  })

  it("burns the soonest-expiring lot first", () => {
    const plan = allocateAcrossNodes(
      [need({ quantity: 5 })],
      [
        lot({ stock_id: "st_fresh", expires_at: inDays(30) }),
        lot({ stock_id: "st_soon", expires_at: inDays(2) }),
      ],
      nodes,
      { now: NOW }
    )
    expect(plan.allocations[0].stock_id).toBe("st_soon")
  })

  it("prefers a hub's own shelves before moving anything", () => {
    const plan = allocateAcrossNodes(
      [need({ node_id: "n_camden", quantity: 5 })],
      [
        lot({ stock_id: "st_remote", node_id: "n_philly", expires_at: inDays(1) }),
        lot({ stock_id: "st_local", node_id: "n_camden", expires_at: inDays(30) }),
      ],
      nodes,
      { now: NOW }
    )

    // Default strategy: a transfer costs handling and risks spoilage, so local
    // stock wins even though the remote lot expires sooner.
    expect(plan.allocations[0].stock_id).toBe("st_local")
    expect(plan.allocations[0].distance_km).toBe(0)
  })

  it("burns the soonest-expiring lot network-wide under expiry_first", () => {
    const plan = allocateAcrossNodes(
      [need({ node_id: "n_camden", quantity: 5 })],
      [
        lot({ stock_id: "st_remote", node_id: "n_philly", expires_at: inDays(1) }),
        lot({ stock_id: "st_local", node_id: "n_camden", expires_at: inDays(30) }),
      ],
      nodes,
      { now: NOW, strategy: "expiry_first" }
    )
    expect(plan.allocations[0].stock_id).toBe("st_remote")
  })

  it("breaks an expiry tie by distance", () => {
    const plan = allocateAcrossNodes(
      [need({ node_id: "n_camden", quantity: 5 })],
      [
        lot({ stock_id: "st_far", node_id: "n_pitt", expires_at: inDays(3) }),
        lot({ stock_id: "st_near", node_id: "n_philly", expires_at: inDays(3) }),
      ],
      nodes,
      { now: NOW }
    )
    expect(plan.allocations[0].stock_id).toBe("st_near")
  })

  it("does not suggest a transfer beyond max_distance_km", () => {
    const plan = allocateAcrossNodes(
      [need({ node_id: "n_camden" })],
      [lot({ node_id: "n_pitt" })],
      nodes,
      { now: NOW, max_distance_km: 50 }
    )
    expect(plan.allocations).toEqual([])
    expect(plan.unmet[0].reason).toBe("out_of_range")
  })

  it("still serves an unmapped hub, which only loses the distance tiebreak", () => {
    const plan = allocateAcrossNodes(
      [need({ node_id: "n_nowhere" })],
      [lot()],
      [PHILLY, { node_id: "n_nowhere" }],
      { now: NOW, max_distance_km: 50 }
    )
    expect(plan.allocations).toHaveLength(1)
    expect(plan.allocations[0].distance_km).toBeNull()
  })

  it("does not plan stock out of a hub that opted out of transfers", () => {
    const plan = allocateAcrossNodes(
      [need({ node_id: "n_camden" })],
      [lot({ node_id: "n_philly" })],
      [{ ...PHILLY, accepts_transfers: false }, CAMDEN],
      { now: NOW }
    )
    expect(plan.allocations).toEqual([])
    expect(plan.unmet[0].reason).toBe("transfers_disabled")
  })

  it("still lets an opted-out hub serve its own demand", () => {
    const plan = allocateAcrossNodes(
      [need({ node_id: "n_philly" })],
      [lot({ node_id: "n_philly" })],
      [{ ...PHILLY, accepts_transfers: false }],
      { now: NOW }
    )
    expect(plan.allocations).toHaveLength(1)
  })

  it("gives scarce stock to whoever needs it soonest", () => {
    const plan = allocateAcrossNodes(
      [
        need({ demand_id: "d_later", node_id: "n_camden", quantity: 10, needed_by: inDays(9) }),
        need({ demand_id: "d_sooner", node_id: "n_pitt", quantity: 10, needed_by: inDays(1) }),
      ],
      [lot({ quantity: 10 })],
      nodes,
      { now: NOW }
    )

    // Array order must not decide who eats.
    expect(plan.allocations).toHaveLength(1)
    expect(plan.allocations[0].demand_id).toBe("d_sooner")
    expect(plan.unmet[0].demand_id).toBe("d_later")
  })

  it("shares one lot across several demands without over-drawing it", () => {
    const plan = allocateAcrossNodes(
      [
        need({ demand_id: "d_a", node_id: "n_camden", quantity: 6 }),
        need({ demand_id: "d_b", node_id: "n_pitt", quantity: 6 }),
      ],
      [lot({ quantity: 10 })],
      nodes,
      { now: NOW }
    )

    const total = plan.allocations.reduce((s, a) => s + a.quantity, 0)
    expect(total).toBe(10)
    expect(plan.leftover).toEqual([])
    expect(plan.unmet.reduce((s, u) => s + u.quantity, 0)).toBe(2)
  })

  it("never matches across different items", () => {
    const plan = allocateAcrossNodes(
      [need({ item_key: "produce.carrots" })],
      [lot({ item_key: "dairy.milk" })],
      nodes,
      { now: NOW }
    )
    expect(plan.allocations).toEqual([])
  })

  it("ignores zero and negative quantities on both sides", () => {
    const plan = allocateAcrossNodes(
      [need({ quantity: 0 }), need({ demand_id: "d_neg", quantity: -5 })],
      [lot({ quantity: 0 }), lot({ stock_id: "st_neg", quantity: -3 })],
      nodes,
      { now: NOW }
    )
    expect(plan.allocations).toEqual([])
    expect(plan.unmet).toEqual([])
    expect(plan.leftover).toEqual([])
  })

  it("is deterministic across runs", () => {
    const demands = [
      need({ demand_id: "d_a", node_id: "n_camden", quantity: 7 }),
      need({ demand_id: "d_b", node_id: "n_pitt", quantity: 7 }),
    ]
    const supplies = [
      lot({ stock_id: "st_a", node_id: "n_philly", quantity: 6 }),
      lot({ stock_id: "st_b", node_id: "n_camden", quantity: 6 }),
    ]

    const first = allocateAcrossNodes(demands, supplies, nodes, { now: NOW })
    const second = allocateAcrossNodes(demands, supplies, nodes, { now: NOW })
    expect(second).toEqual(first)
  })

  it("does not mutate its inputs", () => {
    const supplies = [lot({ quantity: 10 })]
    const snapshot = JSON.parse(JSON.stringify(supplies))
    allocateAcrossNodes([need()], supplies, nodes, { now: NOW })
    expect(supplies).toEqual(snapshot)
  })
})

describe("findExpiringSurplus", () => {
  const supplies = [
    lot({ stock_id: "st_urgent", expires_at: inDays(1) }),
    lot({ stock_id: "st_soon", expires_at: inDays(3) }),
    lot({ stock_id: "st_later", expires_at: inDays(30) }),
    lot({ stock_id: "st_undated", expires_at: null }),
  ]
  const leftover = supplies.map((s) => ({
    stock_id: s.stock_id,
    node_id: s.node_id,
    item_key: s.item_key,
    quantity: 5,
  }))

  it("returns only lots inside the window, soonest first", () => {
    const surplus = findExpiringSurplus(leftover, supplies, 7, NOW)
    expect(surplus.map((s) => s.stock_id)).toEqual(["st_urgent", "st_soon"])
  })

  it("excludes undated stock, which is not at risk", () => {
    const surplus = findExpiringSurplus(leftover, supplies, 365, NOW)
    expect(surplus.map((s) => s.stock_id)).not.toContain("st_undated")
  })

  it("reports days remaining", () => {
    const surplus = findExpiringSurplus(leftover, supplies, 7, NOW)
    expect(surplus[0].days_remaining).toBeCloseTo(1, 5)
  })

  it("returns nothing when there is no leftover to redistribute", () => {
    expect(findExpiringSurplus([], supplies, 7, NOW)).toEqual([])
  })
})
