/**
 * `recordSale` idempotency.
 *
 * `order_cycle_product.sold_quantity` is a bare counter incremented with
 * `sold_quantity + quantity`, so a retried or duplicated `order.placed`
 * double-counted it and no record existed to check against. D9-2 in
 * docs/AUDIT_DEBT.md. Prototype-only service instance: `recordSale` is pure
 * logic over the generated CRUD methods, which are stubbed here.
 */
import OrderCycleModuleService from "../service"

type Product = { id: string; sold_quantity: number }

const makeService = (opts: {
  products?: Product[]
  existingSales?: Array<Record<string, unknown>>
  createThrows?: unknown
} = {}) => {
  const products = opts.products ?? [{ id: "ocp_1", sold_quantity: 10 }]

  const stubs: Record<string, jest.Mock> = {
    listOrderCycleProducts: jest.fn(async () => products),
    listOrderCycleSales: jest.fn(async () => opts.existingSales ?? []),
    createOrderCycleSales: jest.fn(async () => {
      if (opts.createThrows) throw opts.createThrows
      return {}
    }),
    updateOrderCycleProducts: jest.fn(async (args: unknown) => args),
  }

  const service = Object.create(OrderCycleModuleService.prototype) as OrderCycleModuleService

  // `defineProperty`, not assignment. MedusaService installs the generated
  // CRUD methods on the prototype as read-only accessors, so `service.x = fn`
  // is a no-op (or throws) once they exist — and whether they exist yet
  // depends on what else the run has already loaded. An earlier version of
  // this file assigned directly, passed in isolation, and failed seven of
  // eight cases in the full suite. Own data properties shadow the prototype
  // unconditionally.
  for (const [name, fn] of Object.entries(stubs)) {
    Object.defineProperty(service, name, { value: fn, writable: true, configurable: true })
  }

  return service as OrderCycleModuleService & Record<string, jest.Mock>
}

const ORDER = { source: "medusa_order", source_id: "order_1" }

describe("recordSale", () => {
  it("records a first-time sale and increments the counter", async () => {
    const service = makeService()

    await service.recordSale("oc_1", "var_1", 3, ORDER)

    expect(service.createOrderCycleSales).toHaveBeenCalledWith(
      expect.objectContaining({
        order_cycle_id: "oc_1",
        variant_id: "var_1",
        quantity: 3,
        source: "medusa_order",
        source_id: "order_1",
      })
    )
    expect(service.updateOrderCycleProducts).toHaveBeenCalledWith({
      id: "ocp_1",
      sold_quantity: 13,
    })
  })

  it("does not double-count a replayed order.placed", async () => {
    // The regression: before the ledger existed this incremented again.
    const service = makeService({
      existingSales: [{ id: "ocs_1", source_id: "order_1" }],
    })

    await service.recordSale("oc_1", "var_1", 3, ORDER)

    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
    expect(service.createOrderCycleSales).not.toHaveBeenCalled()
  })

  it("treats a unique violation as already-recorded and does not increment", async () => {
    // Two concurrent deliveries of the same event both pass the read check;
    // the unique index is what actually stops the second one. Postgres 23505.
    const service = makeService({ createThrows: { code: "23505", message: "duplicate key value" } })

    await service.recordSale("oc_1", "var_1", 3, ORDER)

    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("recognises a unique violation whose driver code was lost", async () => {
    const service = makeService({
      createThrows: new Error('duplicate key value violates unique constraint "IDX_OCS_DEDUPE"'),
    })

    await service.recordSale("oc_1", "var_1", 3, ORDER)

    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("rethrows an error that is not a unique violation", async () => {
    // A dropped connection must not be mistaken for "already recorded" and
    // silently swallow a real sale.
    const service = makeService({ createThrows: new Error("connection terminated") })

    await expect(service.recordSale("oc_1", "var_1", 3, ORDER)).rejects.toThrow(
      "connection terminated"
    )
    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("stays non-idempotent for a manual adjustment with no source id", async () => {
    // Two identical manual corrections are two corrections.
    const service = makeService()

    await service.recordSale("oc_1", "var_1", 5)

    expect(service.listOrderCycleSales).not.toHaveBeenCalled()
    expect(service.createOrderCycleSales).not.toHaveBeenCalled()
    expect(service.updateOrderCycleProducts).toHaveBeenCalledWith({
      id: "ocp_1",
      sold_quantity: 15,
    })
  })

  it("dedupes per variant, so one order can record several of them", async () => {
    const service = makeService()
    await service.recordSale("oc_1", "var_1", 1, ORDER)

    const filters = (service.listOrderCycleSales as jest.Mock).mock.calls[0][0]
    expect(filters).toEqual(
      expect.objectContaining({ variant_id: "var_1", source_id: "order_1" })
    )
  })

  it("still refuses a variant that is not in the cycle", async () => {
    const service = makeService({ products: [] })
    await expect(service.recordSale("oc_1", "var_x", 1, ORDER)).rejects.toThrow(
      "Product not found in order cycle"
    )
  })
})
