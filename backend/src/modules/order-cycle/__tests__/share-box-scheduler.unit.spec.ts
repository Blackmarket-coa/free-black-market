import OrderCycleModuleService from "../service"

/**
 * Unit-tests the share-box scheduler against an in-memory CRUD fake.
 * Mirrors the pattern in `entitlement-service.unit.spec.ts`: real
 * service prototype, in-memory tables wired onto the instance.
 */
function makeService(): OrderCycleModuleService {
  const tables: Record<string, any[]> = {
    cycles: [],
    products: [],
    sellers: [],
    exchanges: [],
    fees: [],
    enterpriseFees: [],
    templates: [],
    subscriptions: [],
    boxes: [],
  }

  const matchesFilter = (row: any, filters: Record<string, any>) => {
    for (const [k, v] of Object.entries(filters)) {
      if (v === undefined) continue
      if (Array.isArray(v)) {
        if (!v.includes(row[k])) return false
      } else if (
        v !== null &&
        typeof v === "object" &&
        !(v instanceof Date)
      ) {
        // mongo-style $gte / $lte / $gt — not exercised by share-box tests
        continue
      } else {
        if (row[k] !== v) return false
      }
    }
    return true
  }

  const wireTable = (
    svc: any,
    name: string,
    plural: string,
    tableKey: string,
    idPrefix: string
  ) => {
    svc[`list${plural}`] = async (filters: Record<string, any> = {}) =>
      tables[tableKey].filter((r) => matchesFilter(r, filters))
    svc[`create${plural}`] = async (entries: any[]) => {
      const out = entries.map((e, i) => ({
        id: `${idPrefix}_${tables[tableKey].length + i + 1}`,
        ...e,
      }))
      tables[tableKey].push(...out)
      return out
    }
    svc[`update${plural}`] = async (updatesArg: any) => {
      const updates = Array.isArray(updatesArg) ? updatesArg : [updatesArg]
      const out = updates.map((u: any) => {
        const r = tables[tableKey].find((x) => x.id === u.id)
        if (r) Object.assign(r, u)
        return r
      })
      return Array.isArray(updatesArg) ? out : out[0]
    }
    svc[`retrieve${name}`] = async (id: string) =>
      tables[tableKey].find((x) => x.id === id) ?? null
  }

  const svc = Object.create(
    OrderCycleModuleService.prototype
  ) as OrderCycleModuleService

  wireTable(svc, "OrderCycle", "OrderCycles", "cycles", "oc")
  wireTable(svc, "OrderCycleProduct", "OrderCycleProducts", "products", "ocp")
  wireTable(svc, "OrderCycleSeller", "OrderCycleSellers", "sellers", "ocs")
  wireTable(svc, "OrderCycleExchange", "OrderCycleExchanges", "exchanges", "oce")
  wireTable(svc, "OrderCycleFee", "OrderCycleFees", "fees", "ocf")
  wireTable(svc, "EnterpriseFee", "EnterpriseFees", "enterpriseFees", "ef")
  wireTable(svc, "ShareBoxTemplate", "ShareBoxTemplates", "templates", "sbt")
  wireTable(svc, "ShareBoxSubscription", "ShareBoxSubscriptions", "subscriptions", "sbs")
  wireTable(svc, "ShareBox", "ShareBoxes", "boxes", "sb")

  return svc
}

const baseSlots = [
  { key: "leafy_green", quantity: 1, candidate_variant_ids: ["var_kale", "var_chard"] },
  { key: "root_veg", quantity: 1, candidate_variant_ids: ["var_carrot", "var_beet"] },
  { key: "fruit", quantity: 2, candidate_variant_ids: ["var_apple"] },
]

async function seed(svc: OrderCycleModuleService) {
  const [cycle] = await (svc as any).createOrderCycles([
    {
      name: "Week 1",
      opens_at: new Date("2026-05-01"),
      closes_at: new Date("2026-05-07"),
      dispatch_at: new Date("2026-05-08"),
      status: "open",
      coordinator_seller_id: "seller_coord",
    },
  ])
  await (svc as any).createOrderCycleProducts([
    {
      order_cycle_id: cycle.id,
      variant_id: "var_kale",
      seller_id: "seller_p1",
      available_quantity: 5,
      sold_quantity: 0,
      override_price: 300,
      currency_code: "usd",
      is_visible: true,
    },
    {
      order_cycle_id: cycle.id,
      variant_id: "var_chard",
      seller_id: "seller_p1",
      available_quantity: 5,
      sold_quantity: 0,
      override_price: 350,
      currency_code: "usd",
      is_visible: true,
    },
    {
      order_cycle_id: cycle.id,
      variant_id: "var_carrot",
      seller_id: "seller_p2",
      available_quantity: 10,
      sold_quantity: 0,
      override_price: 200,
      currency_code: "usd",
      is_visible: true,
    },
    {
      order_cycle_id: cycle.id,
      variant_id: "var_beet",
      seller_id: "seller_p2",
      available_quantity: 10,
      sold_quantity: 0,
      override_price: 250,
      currency_code: "usd",
      is_visible: true,
    },
    {
      order_cycle_id: cycle.id,
      variant_id: "var_apple",
      seller_id: "seller_p3",
      available_quantity: 20,
      sold_quantity: 0,
      override_price: 100,
      currency_code: "usd",
      is_visible: true,
    },
  ])
  return cycle
}

describe("OrderCycleModuleService — share-box scheduler", () => {
  it("createShareBoxTemplate validates slot definitions", async () => {
    const svc = makeService()
    await expect(
      svc.createShareBoxTemplate({
        coordinator_seller_id: "seller_coord",
        name: "Bad",
        slots: [],
      } as any)
    ).rejects.toThrow(/at least one slot/)
    await expect(
      svc.createShareBoxTemplate({
        coordinator_seller_id: "seller_coord",
        name: "Bad",
        slots: [{ key: "x", quantity: 0 }],
      } as any)
    ).rejects.toThrow(/quantity >= 1/)
    await expect(
      svc.createShareBoxTemplate({
        coordinator_seller_id: "seller_coord",
        name: "Bad",
        slots: [
          { key: "x", quantity: 1 },
          { key: "x", quantity: 1 },
        ],
      } as any)
    ).rejects.toThrow(/duplicated/)
  })

  it("createShareBoxTemplate persists slots and basics", async () => {
    const svc = makeService()
    const tpl = await svc.createShareBoxTemplate({
      coordinator_seller_id: "seller_coord",
      name: "Weekly Veg",
      slots: baseSlots,
    })
    expect(tpl.coordinator_seller_id).toBe("seller_coord")
    expect((tpl.slots as unknown as any[]).map((s) => s.key)).toEqual([
      "leafy_green",
      "root_veg",
      "fruit",
    ])
  })

  it("createShareBoxSubscriptionRecord requires customer or external id", async () => {
    const svc = makeService()
    const tpl = await svc.createShareBoxTemplate({
      coordinator_seller_id: "seller_coord",
      name: "Weekly Veg",
      slots: baseSlots,
    })
    await expect(
      svc.createShareBoxSubscriptionRecord({
        share_box_template_id: tpl.id,
      })
    ).rejects.toThrow(/customer_id or customer_external_id/)
  })

  it("generateBoxesForCycle resolves slots and reserves quantity", async () => {
    const svc = makeService()
    const cycle = await seed(svc)
    const tpl = await svc.createShareBoxTemplate({
      coordinator_seller_id: "seller_coord",
      name: "Weekly Veg",
      slots: baseSlots,
    })
    await svc.createShareBoxSubscriptionRecord({
      share_box_template_id: tpl.id,
      customer_external_id: "@alice:bmc.example",
    })
    await svc.createShareBoxSubscriptionRecord({
      share_box_template_id: tpl.id,
      customer_external_id: "@bob:bmc.example",
    })

    const result = await svc.generateBoxesForCycle(cycle.id)
    expect(result.generated).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.reused).toBe(0)
    expect(result.boxes).toHaveLength(2)

    for (const box of result.boxes) {
      expect(box.status).toBe("allocated")
      const slotKeys = new Set(
        (box.items as any[]).map((i) => i.slot_key)
      )
      expect(slotKeys).toEqual(new Set(["leafy_green", "root_veg", "fruit"]))
      const fruitItems = (box.items as any[]).filter((i) => i.slot_key === "fruit")
      expect(fruitItems.reduce((s: number, i: any) => s + i.quantity, 0)).toBe(2)
      expect(box.total_price).toBeGreaterThan(0)
      expect(box.unfilled_slot_keys).toBeNull()
    }

    // Reservations should reflect into the cycle's product sold_quantity.
    const products = await (svc as any).listOrderCycleProducts({
      order_cycle_id: cycle.id,
    })
    const apples = products.find((p: any) => p.variant_id === "var_apple")
    expect(apples.sold_quantity).toBe(4)
  })

  it("generateBoxesForCycle is idempotent on (subscription, cycle)", async () => {
    const svc = makeService()
    const cycle = await seed(svc)
    const tpl = await svc.createShareBoxTemplate({
      coordinator_seller_id: "seller_coord",
      name: "Weekly Veg",
      slots: baseSlots,
    })
    await svc.createShareBoxSubscriptionRecord({
      share_box_template_id: tpl.id,
      customer_external_id: "@alice:bmc.example",
    })
    const first = await svc.generateBoxesForCycle(cycle.id)
    const second = await svc.generateBoxesForCycle(cycle.id)
    expect(first.generated).toBe(1)
    expect(second.generated).toBe(0)
    expect(second.reused).toBe(1)
  })

  it("generateBoxesForCycle marks a box `skipped` when a slot cannot be filled", async () => {
    const svc = makeService()
    const cycle = await seed(svc)
    // Drop apples from inventory to break the fruit slot.
    const products = await (svc as any).listOrderCycleProducts({
      order_cycle_id: cycle.id,
    })
    const apples = products.find((p: any) => p.variant_id === "var_apple")
    await (svc as any).updateOrderCycleProducts([
      { id: apples.id, available_quantity: 0 },
    ])
    const tpl = await svc.createShareBoxTemplate({
      coordinator_seller_id: "seller_coord",
      name: "Weekly Veg",
      slots: baseSlots,
    })
    await svc.createShareBoxSubscriptionRecord({
      share_box_template_id: tpl.id,
      customer_external_id: "@alice:bmc.example",
    })
    const result = await svc.generateBoxesForCycle(cycle.id)
    expect(result.skipped).toBe(1)
    expect(result.generated).toBe(0)
    expect(result.boxes[0].status).toBe("skipped")
    expect(result.boxes[0].unfilled_slot_keys).toEqual(["fruit"])
  })

  it("generateBoxesForCycle skips paused subscriptions before dispatch_at", async () => {
    const svc = makeService()
    const cycle = await seed(svc)
    const tpl = await svc.createShareBoxTemplate({
      coordinator_seller_id: "seller_coord",
      name: "Weekly Veg",
      slots: baseSlots,
    })
    const sub = await svc.createShareBoxSubscriptionRecord({
      share_box_template_id: tpl.id,
      customer_external_id: "@alice:bmc.example",
    })
    await svc.pauseShareBoxSubscription(sub.id, new Date("2026-05-15"))
    const result = await svc.generateBoxesForCycle(cycle.id)
    expect(result.boxes).toHaveLength(0)
  })

  it("generateBoxesForCycle honors slot_overrides.skip", async () => {
    const svc = makeService()
    const cycle = await seed(svc)
    const tpl = await svc.createShareBoxTemplate({
      coordinator_seller_id: "seller_coord",
      name: "Weekly Veg",
      slots: baseSlots,
    })
    await svc.createShareBoxSubscriptionRecord({
      share_box_template_id: tpl.id,
      customer_external_id: "@alice:bmc.example",
      slot_overrides: { fruit: { skip: true } },
    })
    const result = await svc.generateBoxesForCycle(cycle.id)
    expect(result.generated).toBe(1)
    const items = result.boxes[0].items as any[]
    expect(items.find((i) => i.slot_key === "fruit")).toBeUndefined()
  })

  it("generateBoxesForCycle refuses cancelled cycles", async () => {
    const svc = makeService()
    const cycle = await seed(svc)
    await (svc as any).updateOrderCycles([
      { id: cycle.id, status: "cancelled" },
    ])
    await expect(svc.generateBoxesForCycle(cycle.id)).rejects.toThrow(
      /cancelled cycle/
    )
  })

  it("share-box lifecycle transitions packed → dispatched", async () => {
    const svc = makeService()
    const cycle = await seed(svc)
    const tpl = await svc.createShareBoxTemplate({
      coordinator_seller_id: "seller_coord",
      name: "Weekly Veg",
      slots: baseSlots,
    })
    await svc.createShareBoxSubscriptionRecord({
      share_box_template_id: tpl.id,
      customer_external_id: "@alice:bmc.example",
    })
    const result = await svc.generateBoxesForCycle(cycle.id)
    const box = result.boxes[0]
    const packed = await svc.markShareBoxPacked(box.id)
    expect(packed.status).toBe("packed")
    const dispatched = await svc.markShareBoxDispatched(box.id)
    expect(dispatched.status).toBe("dispatched")
    expect(dispatched.dispatched_at).toBeTruthy()
  })
})
