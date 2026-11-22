import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OrderCycleExchange } from "../../../../hooks/api/order-cycles"

/**
 * POST /vendor/order-cycles/:id/exchanges/:exchangeId/products writes a
 * store's own variants onto its own exchange only, and answers 403 to anyone
 * else, the cycle's coordinator included (SD-158). The coordinator sees every
 * participant's exchange in Supply Chain, so "Add Products" there would always
 * fail; it is offered only on the viewer's own store's exchanges.
 */

const hooks = vi.hoisted(() => ({
  seller: undefined as undefined | { id: string },
  addProducts: { isPending: false, mutateAsync: vi.fn(async () => ({})) },
}))

vi.mock("../../../../hooks/api/users", () => ({
  useMe: () => ({ seller: hooks.seller }),
}))
vi.mock("../../../../hooks/api/order-cycles", () => ({
  useOrderCycleExchanges: () => ({ data: { incoming: [], outgoing: [] }, isLoading: false }),
  useCreateExchange: () => ({ isPending: false, mutateAsync: vi.fn(async () => ({})) }),
  useDeleteExchange: () => ({ isPending: false, mutateAsync: vi.fn(async () => ({})) }),
  useAddProductsToExchange: () => hooks.addProducts,
}))
vi.mock("../../../../hooks/api/products", () => ({
  useProducts: () => ({ products: [], isLoading: false }),
}))

import { ExchangeProducts } from "./order-cycle-exchanges-section"

const exchange = (sellerId: string): OrderCycleExchange =>
  ({
    id: "exch_1",
    order_cycle_id: "oc_1",
    exchange_type: "incoming",
    seller_id: sellerId,
    is_active: true,
    products: [],
  }) as unknown as OrderCycleExchange

const render = (sellerId: string) =>
  renderToStaticMarkup(<ExchangeProducts exchange={exchange(sellerId)} orderCycleId="oc_1" />)

beforeEach(() => {
  hooks.seller = undefined
})

describe("Add Products on an exchange", () => {
  it("is offered on the viewer's own store's exchange", () => {
    hooks.seller = { id: "sel_hub" }
    expect(render("sel_hub")).toContain("Add Products")
  })

  it("is not offered on another store's exchange, as the coordinator sees a participant's", () => {
    hooks.seller = { id: "sel_hub" }
    const html = render("sel_grower")
    expect(html).not.toContain("Add Products")
    // The exchange's products are still listed.
    expect(html).toContain("Products (0)")
  })

  it("is not offered before the viewer's store is known", () => {
    expect(render("sel_hub")).not.toContain("Add Products")
  })
})
