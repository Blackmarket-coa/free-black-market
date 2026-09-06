import OrderCycleModuleService from "../service"

/**
 * `getActiveOrderCycles(sellerId)` and `getUpcomingOrderCycles(sellerId)`
 * mapped `order_cycle_seller.id` where the cycle id was needed, so both
 * always returned nothing for a seller with memberships
 * (`docs/CDFI_COOP_ROADMAP.md` §1a). Real prototype, fake `this`, following
 * the in-memory pattern of `share-box-scheduler.unit.spec.ts`.
 */

type ListFn = jest.Mock<Promise<unknown[]>, [Record<string, unknown>, unknown?]>

const makeFake = (memberships: Array<{ id: string; order_cycle_id: string }>) => {
  const fake = {
    listOrderCycleSellers: jest.fn().mockResolvedValue(memberships) as ListFn,
    listOrderCycles: jest.fn().mockResolvedValue([]) as ListFn,
  }
  return fake as unknown as OrderCycleModuleService & typeof fake
}

describe("order-cycle service — seller-scoped cycle lookups", () => {
  it("getActiveOrderCycles filters on the membership's order_cycle_id", async () => {
    const fake = makeFake([{ id: "ocs_1", order_cycle_id: "oc_1" }])

    await OrderCycleModuleService.prototype.getActiveOrderCycles.call(fake, "sel_1")

    expect(fake.listOrderCycleSellers).toHaveBeenCalledWith({ seller_id: "sel_1", is_active: true })
    const [filters] = fake.listOrderCycles.mock.calls[0]
    expect(filters).toMatchObject({ status: "open", id: ["oc_1"] })
  })

  it("getUpcomingOrderCycles filters on the membership's order_cycle_id", async () => {
    const fake = makeFake([{ id: "ocs_2", order_cycle_id: "oc_2" }])

    await OrderCycleModuleService.prototype.getUpcomingOrderCycles.call(fake, "sel_1", 5)

    const [filters, config] = fake.listOrderCycles.mock.calls[0]
    expect(filters).toMatchObject({ status: ["draft", "upcoming"], id: ["oc_2"] })
    expect(config).toMatchObject({ take: 5 })
  })

  it("returns nothing, without a cycle query, for a seller with no memberships", async () => {
    const fake = makeFake([])

    const active = await OrderCycleModuleService.prototype.getActiveOrderCycles.call(fake, "sel_none")

    expect(active).toEqual([])
    expect(fake.listOrderCycles).not.toHaveBeenCalled()
  })
})
