/**
 * `recordSale` increments `sold_quantity` atomically, and says so when the
 * result is oversold. D9-1 in docs/AUDIT_DEBT.md.
 *
 * The bug this pins was not only "a cycle can oversell". It was a lost update:
 * the counter was read, added to, and written back, so two buyers completing
 * at once both read the same starting value and the second write erased the
 * first. The cycle then undercounted its own sales — it oversold *and* failed
 * to record that it had.
 *
 * Prototype-only service instance, as in `record-sale-idempotency`, with a
 * stub pg connection standing in for the database.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import OrderCycleModuleService from "../service"

type Row = { sold_quantity: number; available_quantity: number | null }

const makeService = (opts: {
  product?: { id: string; sold_quantity: number }
  /** Rows the UPDATE ... RETURNING hands back. */
  returning?: Row[]
  withPg?: boolean
}) => {
  const product = opts.product ?? { id: "ocp_1", sold_quantity: 10 }
  const raw = jest.fn(async () => ({
    rows: opts.returning ?? [{ sold_quantity: 13, available_quantity: 100 }],
  }))

  const stubs: Record<string, jest.Mock> = {
    listOrderCycleProducts: jest.fn(async () => [product]),
    listOrderCycleSales: jest.fn(async () => []),
    createOrderCycleSales: jest.fn(async () => ({})),
    updateOrderCycleProducts: jest.fn(async (args: unknown) => args),
    retrieveOrderCycleProduct: jest.fn(async (id: string) => ({ id })),
  }

  const service = Object.create(OrderCycleModuleService.prototype) as OrderCycleModuleService
  for (const [name, fn] of Object.entries(stubs)) {
    Object.defineProperty(service, name, { value: fn, writable: true, configurable: true })
  }
  if (opts.withPg !== false) {
    Object.defineProperty(service, "__container__", {
      // Keyed on the framework constant, not a hand-typed string: a guessed
      // key resolves nothing, the service takes its no-DI fallback, and the
      // test would pass while proving the opposite of what it claims.
      value: {
        resolve: (k: string) =>
          k === ContainerRegistrationKeys.PG_CONNECTION ? { raw } : undefined,
      },
      writable: true,
      configurable: true,
    })
  }

  return { service: service as OrderCycleModuleService & Record<string, jest.Mock>, raw }
}

const ORDER = { source: "medusa_order", source_id: "order_1" }

describe("recordSale — atomic increment", () => {
  it("increments with col = col + n rather than writing a computed total", async () => {
    // The whole point: the new value is never computed in JS from a value read
    // earlier, so a concurrent increment cannot be overwritten.
    const { service, raw } = makeService({})

    await service.recordSale("oc_1", "var_1", 3, ORDER)

    expect(raw).toHaveBeenCalledTimes(1)
    const [sql, bindings] = raw.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/"sold_quantity"\s*=\s*"sold_quantity"\s*\+\s*\?/)
    expect(sql).toMatch(/RETURNING/i)
    expect(bindings).toEqual([3, "ocp_1"])
    // And it must not fall back to the read-modify-write path.
    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })

  it("only counts rows that are not soft-deleted", async () => {
    const { service, raw } = makeService({})
    await service.recordSale("oc_1", "var_1", 1, ORDER)
    const [sql] = raw.mock.calls[0] as unknown as [string]
    expect(sql).toMatch(/"deleted_at"\s+IS\s+NULL/i)
  })

  it("records the sale even when it goes past capacity", async () => {
    // This runs after the buyer has paid. Refusing here would leave the money
    // taken and the coordinator unaware of an order they have to pack.
    const { service } = makeService({
      returning: [{ sold_quantity: 12, available_quantity: 10 }],
    })

    await expect(service.recordSale("oc_1", "var_1", 4, ORDER)).resolves.toBeDefined()
  })

  it("treats a null capacity as unlimited rather than as zero", async () => {
    const { service } = makeService({
      returning: [{ sold_quantity: 5000, available_quantity: null }],
    })

    await expect(service.recordSale("oc_1", "var_1", 1, ORDER)).resolves.toBeDefined()
  })

  it("throws when the product disappeared between the read and the write", async () => {
    const { service } = makeService({ returning: [] })

    await expect(service.recordSale("oc_1", "var_1", 1, ORDER)).rejects.toThrow(
      /not found/i
    )
  })

  it("falls back to read-modify-write when no connection is reachable", async () => {
    // Unit tests without DI. Not race-safe, and cannot be — there is no
    // database to be atomic against.
    const { service } = makeService({ withPg: false })

    await service.recordSale("oc_1", "var_1", 3, ORDER)

    expect(service.updateOrderCycleProducts).toHaveBeenCalledWith({
      id: "ocp_1",
      sold_quantity: 13,
    })
  })

  it("still short-circuits a duplicate before touching the counter", async () => {
    // D9-2's idempotency must survive the change: an already-recorded sale
    // returns without incrementing at all.
    const { service, raw } = makeService({})
    Object.defineProperty(service, "listOrderCycleSales", {
      value: jest.fn(async () => [{ id: "ocs_1" }]),
      writable: true,
      configurable: true,
    })

    await service.recordSale("oc_1", "var_1", 3, ORDER)

    expect(raw).not.toHaveBeenCalled()
    expect(service.updateOrderCycleProducts).not.toHaveBeenCalled()
  })
})
