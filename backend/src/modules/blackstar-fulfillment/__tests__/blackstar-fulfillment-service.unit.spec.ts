import BlackstarFulfillmentModuleService from "../service"

function make(): BlackstarFulfillmentModuleService {
  const rows: any[] = []
  const svc = Object.create(
    BlackstarFulfillmentModuleService.prototype
  ) as BlackstarFulfillmentModuleService

  ;(svc as any).listBlackstarShipments = async (f: Record<string, any> = {}) =>
    rows.filter((r) =>
      Object.entries(f).every(([k, v]) => v === undefined || r[k] === v)
    )
  ;(svc as any).createBlackstarShipments = async (entries: any[]) => {
    const out = entries.map((e, i) => ({ id: `bsh_${rows.length + i + 1}`, ...e }))
    rows.push(...out)
    return out
  }
  ;(svc as any).updateBlackstarShipments = async (updates: any[]) =>
    updates.map((u) => {
      const r = rows.find((x) => x.id === u.id)
      if (r) Object.assign(r, u)
      return r
    })

  return svc
}

describe("BlackstarFulfillmentModuleService", () => {
  it("recordOrUpdateShipment creates then updates the same row", async () => {
    const svc = make()
    const a = await svc.recordOrUpdateShipment({
      order_id: "order_1",
      fulfillment_node_id: "node_a",
    })
    expect(a.fulfillment_node_id).toBe("node_a")

    const b = await svc.recordOrUpdateShipment({
      order_id: "order_1",
      pickup_point_id: "pp_1",
      external_status: "ready",
    })
    expect(b.id).toBe(a.id)
    expect(b.pickup_point_id).toBe("pp_1")
    expect(b.external_status).toBe("ready")
    expect(b.fulfillment_node_id).toBe("node_a")
  })
})
