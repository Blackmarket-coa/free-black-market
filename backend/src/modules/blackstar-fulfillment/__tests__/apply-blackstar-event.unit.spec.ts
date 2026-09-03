import { decideStatusWrite } from "../shipment-lifecycle"

/**
 * The service method's logic, exercised against in-memory stores.
 *
 * `applyBlackstarEvent` is a MedusaService method, so instantiating the real
 * class needs a container. What is worth pinning is the composition — replay
 * short-circuit, guard, metadata merge, receipt outcome — so that is
 * reproduced here against the same pure `decideStatusWrite` the service uses.
 * The guard itself is covered directly in `shipment-lifecycle.unit.spec.ts`.
 */

type Shipment = {
  id: string
  order_id: string
  external_status: string | null
  fulfillment_node_id: string | null
  metadata: Record<string, unknown> | null
}

type Receipt = {
  event_id: string
  outcome: string
  requested_status: string | null
  resulting_status: string | null
}

const makeStore = () => {
  const shipments: Shipment[] = []
  const receipts: Receipt[] = []

  const apply = (input: {
    event_id?: string | null
    event_type: string
    source_order_ref: string
    external_status: string
    fulfillment_node_id?: string | null
    metadata?: Record<string, unknown> | null
  }) => {
    if (input.event_id) {
      const seen = receipts.find((r) => r.event_id === input.event_id)
      if (seen) {
        return {
          processed: false,
          decision: { apply: false, reason: "same_status" as const },
          resulting_status: seen.resulting_status,
        }
      }
    }

    const existing = shipments.find((s) => s.order_id === input.source_order_ref)
    const decision = decideStatusWrite(existing?.external_status, input.external_status)

    const metadata: Record<string, unknown> = {
      ...(existing?.metadata ?? {}),
      ...(input.metadata ?? {}),
    }
    if (decision.apply) {
      metadata.last_applied_event_id = input.event_id ?? null
      metadata.last_applied_event_type = input.event_type
    } else {
      metadata.last_skipped_event_id = input.event_id ?? null
      metadata.last_skipped_event_type = input.event_type
      metadata.last_skipped_reason = decision.reason
    }

    let shipment: Shipment
    if (existing) {
      if (decision.apply) existing.external_status = input.external_status
      existing.fulfillment_node_id =
        input.fulfillment_node_id ?? existing.fulfillment_node_id
      existing.metadata = metadata
      shipment = existing
    } else {
      shipment = {
        id: `bss_${shipments.length + 1}`,
        order_id: input.source_order_ref,
        external_status: decision.apply ? input.external_status : null,
        fulfillment_node_id: input.fulfillment_node_id ?? null,
        metadata,
      }
      shipments.push(shipment)
    }

    if (input.event_id) {
      receipts.push({
        event_id: input.event_id,
        outcome: decision.reason,
        requested_status: input.external_status,
        resulting_status: shipment.external_status,
      })
    }

    return { processed: true, decision, resulting_status: shipment.external_status }
  }

  return { shipments, receipts, apply }
}

describe("applyBlackstarEvent: replay", () => {
  it("short-circuits a redelivered event without re-evaluating it", () => {
    const store = makeStore()
    store.apply({
      event_id: "evt_1",
      event_type: "shipment.delivered",
      source_order_ref: "ord_1",
      external_status: "delivered",
    })

    const replay = store.apply({
      event_id: "evt_1",
      event_type: "shipment.delivered",
      source_order_ref: "ord_1",
      external_status: "delivered",
    })

    expect(replay.processed).toBe(false)
    expect(store.receipts).toHaveLength(1)
    expect(store.shipments[0].external_status).toBe("delivered")
  })

  it("still handles an event with no event_id, rather than dropping it", () => {
    // event_id is required by contract v1, but a receiver that silently ate
    // an envelope missing one would lose a real lifecycle change.
    const store = makeStore()
    const result = store.apply({
      event_type: "shipment.claimed",
      source_order_ref: "ord_1",
      external_status: "claimed",
    })
    expect(result.processed).toBe(true)
    expect(store.shipments[0].external_status).toBe("claimed")
    expect(store.receipts).toHaveLength(0)
  })
})

describe("applyBlackstarEvent: out-of-order delivery", () => {
  it("keeps delivered when a delayed in_transit retry lands after it", () => {
    const store = makeStore()
    store.apply({
      event_id: "evt_delivered",
      event_type: "shipment.delivered",
      source_order_ref: "ord_1",
      external_status: "delivered",
    })
    const late = store.apply({
      event_id: "evt_transit",
      event_type: "shipment.in_transit",
      source_order_ref: "ord_1",
      external_status: "in_transit",
    })

    expect(late.decision.reason).toBe("out_of_order")
    expect(store.shipments[0].external_status).toBe("delivered")
  })

  it("records the skip so it is distinguishable from a lost event", () => {
    const store = makeStore()
    store.apply({
      event_id: "evt_delivered",
      event_type: "shipment.delivered",
      source_order_ref: "ord_1",
      external_status: "delivered",
    })
    store.apply({
      event_id: "evt_transit",
      event_type: "shipment.in_transit",
      source_order_ref: "ord_1",
      external_status: "in_transit",
    })

    const receipt = store.receipts.find((r) => r.event_id === "evt_transit")
    expect(receipt).toMatchObject({
      outcome: "out_of_order",
      requested_status: "in_transit",
      resulting_status: "delivered",
    })
  })

  it("does not let a skipped event's stamp contradict the live status", () => {
    // The metadata bug: a whole-blob replace would leave
    // last_event_type: in_transit on a shipment reading delivered.
    const store = makeStore()
    store.apply({
      event_id: "evt_delivered",
      event_type: "shipment.delivered",
      source_order_ref: "ord_1",
      external_status: "delivered",
    })
    store.apply({
      event_id: "evt_transit",
      event_type: "shipment.in_transit",
      source_order_ref: "ord_1",
      external_status: "in_transit",
    })

    const md = store.shipments[0].metadata!
    expect(md.last_applied_event_type).toBe("shipment.delivered")
    expect(md.last_skipped_event_type).toBe("shipment.in_transit")
    expect(md.last_skipped_reason).toBe("out_of_order")
  })
})

describe("applyBlackstarEvent: non-status data", () => {
  it("still records a node id carried by a refused event", () => {
    // Refusing the status is not a reason to drop identifiers we did not have.
    const store = makeStore()
    store.apply({
      event_id: "evt_delivered",
      event_type: "shipment.delivered",
      source_order_ref: "ord_1",
      external_status: "delivered",
    })
    store.apply({
      event_id: "evt_transit",
      event_type: "shipment.in_transit",
      source_order_ref: "ord_1",
      external_status: "in_transit",
      fulfillment_node_id: "node_7",
    })

    expect(store.shipments[0].fulfillment_node_id).toBe("node_7")
    expect(store.shipments[0].external_status).toBe("delivered")
  })

  it("merges metadata across events instead of replacing it", () => {
    const store = makeStore()
    store.apply({
      event_id: "evt_1",
      event_type: "shipment.claimed",
      source_order_ref: "ord_1",
      external_status: "claimed",
      metadata: { shipment_listing_id: "listing_1" },
    })
    store.apply({
      event_id: "evt_2",
      event_type: "shipment.in_transit",
      source_order_ref: "ord_1",
      external_status: "in_transit",
      metadata: { last_reported_status: "moving" },
    })

    const md = store.shipments[0].metadata!
    expect(md.shipment_listing_id).toBe("listing_1")
    expect(md.last_reported_status).toBe("moving")
  })
})
