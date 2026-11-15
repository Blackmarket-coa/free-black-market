import Service from "../service"

// Exercise the production service; replace only Medusa persistence methods.
function make() {
  const shipments: Record<string, unknown>[] = []
  const receipts: Record<string, unknown>[] = []
  const service = Object.create(Service.prototype) as Service
  const matches = (row: Record<string, unknown>, filters: Record<string, unknown>) =>
    Object.entries(filters).every(([key, value]) => row[key] === value)
  Object.assign(service, {
    listBlackstarShipments: async (filters: Record<string, unknown>) => shipments.filter((r) => matches(r, filters)),
    listBlackstarEventReceipts: async (filters: Record<string, unknown>) => receipts.filter((r) => matches(r, filters)),
    createBlackstarShipments: async (entries: Record<string, unknown>[]) => {
      const created = entries.map((entry, i) => ({ id: `shipment_${shipments.length + i}`, ...entry }))
      shipments.push(...created)
      return created
    },
    updateBlackstarShipments: async (entries: Record<string, unknown>[]) => entries.map((entry) => {
      const row = shipments.find((r) => r.id === entry.id)!
      Object.assign(row, entry)
      return row
    }),
    createBlackstarEventReceipts: async (entries: Record<string, unknown>[]) => {
      receipts.push(...entries)
      return entries
    },
  })
  return { service, shipments, receipts }
}
const event = (fulfillment: string | null, status = "delivered") => ({
  event_id: `evt_${fulfillment}_${status}`, event_type: `shipment.${status}`,
  source_order_ref: "order_1", source_fulfillment_ref: fulfillment, external_status: status,
})
it("delivers one parcel without changing its sibling and deduplicates replay", async () => {
  const { service, shipments, receipts } = make()
  for (const id of ["ful_1", "ful_2"]) {
    await service.recordOrUpdateShipment({ order_id: "order_1", fulfillment_id: id, external_status: "pending" })
  }
  await service.applyBlackstarEvent(event("ful_1"))
  expect(shipments.map((r) => r.external_status)).toEqual(["delivered", "pending"])
  expect((await service.applyBlackstarEvent(event("ful_1"))).processed).toBe(false)
  expect(receipts).toHaveLength(1)
  await service.applyBlackstarEvent(event("ful_1", "in_transit"))
  expect(shipments[0].external_status).toBe("delivered")
  expect(receipts[1].outcome).toBe("out_of_order")
})
it("keeps an early scoped event attached to its fulfillment", async () => {
  const { service, shipments } = make()
  await service.applyBlackstarEvent(event("ful_2"))
  await service.recordOrUpdateShipment({ order_id: "order_1", fulfillment_id: "ful_1", external_status: "pending" })
  expect(shipments).toHaveLength(2)
  expect(shipments[0]).toMatchObject({ fulfillment_id: "ful_2", external_status: "delivered" })
})
it("records ambiguous legacy events without changing either parcel", async () => {
  const { service, shipments, receipts } = make()
  for (const id of ["ful_1", "ful_2"]) {
    await service.recordOrUpdateShipment({ order_id: "order_1", fulfillment_id: id, external_status: "pending" })
  }
  expect((await service.applyBlackstarEvent(event(null))).decision).toEqual({ apply: false, reason: "ambiguous_shipment" })
  expect(shipments.map((r) => r.external_status)).toEqual(["pending", "pending"])
  expect(receipts[0].outcome).toBe("ambiguous_shipment")
})
it("accepts legacy events for a single parcel", async () => {
  const { service, shipments } = make()
  await service.recordOrUpdateShipment({ order_id: "order_1", fulfillment_id: "ful_1", external_status: "pending" })
  await service.applyBlackstarEvent(event(null))
  expect(shipments[0].external_status).toBe("delivered")
})
it("does not match the same fulfillment reference on another order", async () => {
  const { service, shipments } = make()
  await service.recordOrUpdateShipment({ order_id: "other_order", fulfillment_id: "ful_1", external_status: "pending" })
  await service.applyBlackstarEvent(event("ful_1"))
  expect(shipments[0].external_status).toBe("pending")
  expect(shipments[1]).toMatchObject({ order_id: "order_1", fulfillment_id: "ful_1", external_status: "delivered" })
})
