import { BigNumber, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { HAWALA_LEDGER_MODULE } from "../../modules/hawala-ledger"
import { ORDER_DISPUTE_MODULE } from "../../modules/order-dispute"
import { DisputeReason } from "../../modules/order-dispute/resolution"
import {
  ORDER_FIELDS_FOR_DISPUTE,
  isIntakeFailure,
  loadOwnOrderForDispute,
  openDisputeForOrder,
  resolveDisputeTarget,
  type OrderForDispute,
} from "../order-dispute-intake"

/**
 * The dispute intake, against orders shaped the way `query.graph` returns
 * them on a real database (checked there by
 * `integration-tests/http/admin-disputes.spec.ts`): item totals in MAJOR
 * units, often as a BigNumber, and the seller reached through Mercur's
 * product→seller link (`product.seller.id`) or the order's own seller link.
 *
 * The container resolves only the keys the code imports (the query, the
 * dispute module, the ledger module) and throws on anything else, so a
 * guessed key fails here instead of falling through to a default.
 */

type Line = { total: unknown; product?: { seller?: { id: string } | null } | null }

const order = (over: Partial<{ customer_id: string; currency_code: string; items: Line[]; seller: { id: string } | null }> = {}) => ({
  id: "order_1",
  customer_id: "cus_1",
  created_at: new Date().toISOString(),
  currency_code: "usd",
  seller: null,
  items: [] as Line[],
  ...over,
})

const line = (total: unknown, sellerId: string | null = "sel_a"): Line => ({
  total,
  product: sellerId ? { seller: { id: sellerId } } : null,
})

function containerWith(row: unknown, extra: Record<string, unknown> = {}) {
  const graph = jest.fn().mockResolvedValue({ data: row ? [row] : [] })
  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    ...extra,
  }
  const container = {
    resolve: (key: string) => {
      if (!(key in registry)) throw new Error(`unexpected container key: ${key}`)
      return registry[key]
    },
  } as unknown as MedusaContainer
  return { container, graph }
}

describe("loadOwnOrderForDispute", () => {
  it("turns Medusa's major-unit line totals into minor units", async () => {
    const { container } = containerWith(order({ items: [line(25.99)] }))
    const loaded = await loadOwnOrderForDispute(container, { orderId: "order_1", customerId: "cus_1" })
    expect(isIntakeFailure(loaded)).toBe(false)
    expect((loaded as OrderForDispute).items).toEqual([{ seller_id: "sel_a", total: 2599 }])
  })

  it("reads a BigNumber total, as query.graph returns one, and a numeric string", async () => {
    const { container } = containerWith(order({ items: [line(new BigNumber(25.99)), line("12.5")] }))
    const loaded = (await loadOwnOrderForDispute(container, { orderId: "order_1", customerId: "cus_1" })) as OrderForDispute
    expect(loaded.items.map((i) => i.total)).toEqual([2599, 1250])
  })

  it("uses the currency's own minor unit", async () => {
    const { container } = containerWith(order({ currency_code: "jpy", items: [line(5000)] }))
    const loaded = (await loadOwnOrderForDispute(container, { orderId: "order_1", customerId: "cus_1" })) as OrderForDispute
    expect(loaded.items[0].total).toBe(5000)
  })

  it("asks for a top-level total (which makes Medusa compute item totals) and the linked seller", async () => {
    const { container, graph } = containerWith(order({ items: [line(1)] }))
    await loadOwnOrderForDispute(container, { orderId: "order_1", customerId: "cus_1" })
    const fields = graph.mock.calls[0][0].fields as string[]
    expect(fields).toBe(ORDER_FIELDS_FOR_DISPUTE)
    expect(fields).toEqual(expect.arrayContaining(["total", "items.*", "items.product.seller.id", "seller.id"]))
    // Neither exists: `items.total` without `total` throws in MikroORM, and
    // `product.seller_id` is silently dropped.
    expect(fields).not.toContain("items.total")
    expect(fields).not.toContain("items.product.seller_id")
  })

  it("attributes a line with no product link to the order's own seller", async () => {
    const { container } = containerWith(
      order({ seller: { id: "sel_order" }, items: [line(10, null), line(5, "sel_b")] })
    )
    const loaded = (await loadOwnOrderForDispute(container, { orderId: "order_1", customerId: "cus_1" })) as OrderForDispute
    expect(loaded.items).toEqual([
      { seller_id: "sel_order", total: 1000 },
      { seller_id: "sel_b", total: 500 },
    ])
  })

  it("someone else's order and no order at all are the same 404", async () => {
    const theirs = containerWith(order({ customer_id: "cus_other", items: [line(1)] }))
    const missing = containerWith(null)
    for (const { container } of [theirs, missing]) {
      expect(await loadOwnOrderForDispute(container, { orderId: "order_1", customerId: "cus_1" })).toEqual({
        ok: false,
        status: 404,
        body: { message: "Order not found", type: "not_found" },
      })
    }
  })
})

describe("resolveDisputeTarget", () => {
  const loaded = async (items: Line[]) => {
    const { container } = containerWith(order({ items }))
    return (await loadOwnOrderForDispute(container, { orderId: "order_1", customerId: "cus_1" })) as OrderForDispute
  }

  it("caps the claim at the seller's goods, in minor units", async () => {
    expect(resolveDisputeTarget(await loaded([line(25.99)]))).toEqual({ sellerId: "sel_a", ceilingCents: 2599 })
  })

  it("two $12.99 lines are $25.98, not the 24 that flooring each line gave", async () => {
    expect(resolveDisputeTarget(await loaded([line(12.99), line(12.99)]))).toEqual({
      sellerId: "sel_a",
      ceilingCents: 2598,
    })
  })

  it("counts only the named seller's lines on a two-seller order", async () => {
    const two = await loaded([line(12.99, "sel_a"), line(30, "sel_b")])
    expect(resolveDisputeTarget(two, "sel_b")).toEqual({ sellerId: "sel_b", ceilingCents: 3000 })
    expect(resolveDisputeTarget(two)).toMatchObject({ ok: false, status: 400, body: { type: "ambiguous_vendor" } })
  })

  it("an order whose lines name no seller has no vendor to dispute", async () => {
    expect(resolveDisputeTarget(await loaded([line(10, null)]))).toMatchObject({
      ok: false,
      status: 409,
      body: { type: "no_vendor" },
    })
  })
})

describe("openDisputeForOrder", () => {
  it("opens the dispute with the claim ceiling in minor units", async () => {
    const open = jest.fn().mockImplementation(async (args: { orderTotalCents: number }) => ({
      id: "odsp_1",
      claim_amount: args.orderTotalCents,
    }))
    const disputes = { liveForOrder: jest.fn().mockResolvedValue(null), open, updateOrderDisputes: jest.fn() }
    const hawala = { listEscrowAgreements: jest.fn().mockResolvedValue([]) }
    const { container } = containerWith(order({ items: [line(12.99), line(12.99)] }), {
      [ORDER_DISPUTE_MODULE]: disputes,
      [HAWALA_LEDGER_MODULE]: hawala,
    })

    const result = await openDisputeForOrder(container, {
      customerId: "cus_1",
      orderId: "order_1",
      reason: DisputeReason.NOT_RECEIVED,
      description: "Never arrived.",
    })

    expect(result).toEqual({ ok: true, dispute: { id: "odsp_1", claim_amount: 2598 } })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toMatchObject({
      orderId: "order_1",
      sellerId: "sel_a",
      customerId: "cus_1",
      orderTotalCents: 2598,
      currencyCode: "usd",
      claimCents: null,
      escrowAgreementId: null,
    })
    expect(hawala.listEscrowAgreements).toHaveBeenCalledWith({ subject_type: "order", subject_id: "order_1" })
  })
})
