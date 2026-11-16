// Medusa's three workflows run for real, on Postgres, in
// integration-tests/http/cart-payment-refresh.spec.ts. Here they are
// recorders: what matters is which run, in what order, with what input, and
// what the caller is told when one fails.
const runs: Array<{ workflow: string; input: unknown }> = []
const failing = new Map<string, Error>()
// jest hoists the mock above these consts and Medusa's workflows are looked
// up when the module under test loads, so each is a function that only reads
// them when it is run.
const run = async (name: string, input: unknown) => {
  runs.push({ workflow: name, input })
  const error = failing.get(name)
  if (error) throw error
  return { result: undefined }
}
jest.mock("@medusajs/medusa/core-flows", () => {
  const workflow = (name: string) => () => ({ run: ({ input }: { input: unknown }) => run(name, input) })
  return {
    refreshPaymentCollectionForCartWorkflow: workflow("refresh-payment-collection"),
    refreshCartItemsWorkflow: workflow("refresh-cart-items"),
    deletePaymentSessionsWorkflow: workflow("delete-payment-sessions"),
  }
})

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refreshCartAfterReprice, refreshCartPaymentCollection } from "../cart-payment-refresh"

/**
 * SD-115: what runs after a write that changed a cart's total, and after a
 * completion refused for its session's amount. Medusa's refresh, then the
 * sessions it left that are not for the total: its refresh does nothing when
 * the collection already agrees with the total, and a session opened while
 * the total was changing can still be for the old one.
 */

type Session = { id: string; amount: unknown; status: string }
type Cart = { id: string; completed_at: unknown; currency_code: string; total: unknown; payment_collection: { payment_sessions: Session[] } | null }

function scopeWith(cart: Cart | undefined) {
  const graph = jest.fn(async (_args: { entity: string; fields: string[]; filters: { id: string } }) => ({ data: cart ? [cart] : [] }))
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected resolve ${key}`)
  })
  return { scope: { resolve } as unknown as MedusaContainer, graph, resolve }
}

const cartWith = (total: unknown, sessions: Session[]): Cart => ({
  id: "cart_1",
  completed_at: null,
  currency_code: "usd",
  total,
  payment_collection: { payment_sessions: sessions },
})

beforeEach(() => {
  runs.length = 0
  failing.clear()
})

describe.each([
  ["refreshCartPaymentCollection", refreshCartPaymentCollection, "refresh-payment-collection"],
  ["refreshCartAfterReprice", refreshCartAfterReprice, "refresh-cart-items"],
] as const)("%s", (_name, settle, medusaWorkflow) => {
  it("runs Medusa's workflow for the cart, then reads the cart it left", async () => {
    const t = scopeWith(cartWith(34, []))
    await settle(t.scope, "cart_1")

    expect(runs).toEqual([{ workflow: medusaWorkflow, input: { cart_id: "cart_1" } }])
    expect(t.graph).toHaveBeenCalledTimes(1)
    expect(t.graph).toHaveBeenCalledWith({
      entity: "cart",
      fields: [
        "id",
        "completed_at",
        "currency_code",
        "total",
        "payment_collection.id",
        "payment_collection.payment_sessions.id",
        "payment_collection.payment_sessions.amount",
        "payment_collection.payment_sessions.status",
      ],
      filters: { id: "cart_1" },
    })
  })

  it("a session for the total is left alone", async () => {
    const t = scopeWith(cartWith(34, [{ id: "payses_1", amount: 34, status: "pending" }]))
    await settle(t.scope, "cart_1")
    expect(runs.map((r) => r.workflow)).toEqual([medusaWorkflow])
  })

  it("the collection agreed with the total, so Medusa's workflow deleted nothing, and a session is still for the old total: it is deleted", async () => {
    // The state a session opened during a delivery change is left in: total
    // 19, collection 19, pending session 17.
    const t = scopeWith(
      cartWith(19, [
        { id: "payses_raced", amount: 17, status: "pending" },
        { id: "payses_held", amount: 17, status: "authorized" },
        { id: "payses_taken", amount: 17, status: "captured" },
      ])
    )
    await settle(t.scope, "cart_1")

    expect(runs).toEqual([
      { workflow: medusaWorkflow, input: { cart_id: "cart_1" } },
      // Never the captured one.
      { workflow: "delete-payment-sessions", input: { ids: ["payses_raced", "payses_held"] } },
    ])
  })

  it("Medusa's workflow fails: it throws, and no session is looked for", async () => {
    failing.set(medusaWorkflow, new Error("Failed to acquire lock for key cart_1"))
    const t = scopeWith(cartWith(19, [{ id: "payses_raced", amount: 17, status: "pending" }]))
    await expect(settle(t.scope, "cart_1")).rejects.toThrow("Failed to acquire lock")
    expect(t.graph).not.toHaveBeenCalled()
    expect(runs.map((r) => r.workflow)).toEqual([medusaWorkflow])
  })

  it("the session cannot be deleted and is still there: it throws, so the caller does not report the cart as settled", async () => {
    failing.set("delete-payment-sessions", new Error("Could not delete all payment sessions"))
    const t = scopeWith(cartWith(19, [{ id: "payses_raced", amount: 17, status: "pending" }]))
    await expect(settle(t.scope, "cart_1")).rejects.toThrow("Could not delete all payment sessions")
    expect(t.graph).toHaveBeenCalledTimes(2)
  })

  it("the delete fails because another request had already deleted the session: the cart is read again, nothing is left for another amount, and it does not throw", async () => {
    failing.set("delete-payment-sessions", new Error("Could not delete all payment sessions"))
    const cart = cartWith(19, [{ id: "payses_raced", amount: 17, status: "pending" }])
    const t = scopeWith(cart)
    t.graph.mockImplementationOnce(async () => ({ data: [cart] }))
    t.graph.mockImplementationOnce(async () => ({ data: [cartWith(19, [{ id: "payses_new", amount: 19, status: "pending" }])] }))
    await expect(settle(t.scope, "cart_1")).resolves.toBeUndefined()
    expect(runs.map((r) => r.workflow)).toEqual([medusaWorkflow, "delete-payment-sessions"])
  })

  it("a cart that is gone, completed, or whose total cannot be read has no session deleted", async () => {
    const stale = [{ id: "payses_1", amount: 17, status: "pending" }]
    for (const cart of [undefined, { ...cartWith(19, stale), completed_at: new Date() }, cartWith(null, stale), { ...cartWith(19, stale), payment_collection: null }]) {
      runs.length = 0
      await settle(scopeWith(cart).scope, "cart_1")
      expect(runs.map((r) => r.workflow)).toEqual([medusaWorkflow])
    }
  })

  it("reads through the query and resolves nothing else: no ledger (Posture A)", async () => {
    const t = scopeWith(cartWith(19, [{ id: "payses_raced", amount: 17, status: "pending" }]))
    await settle(t.scope, "cart_1")
    expect([...new Set(t.resolve.mock.calls.map((c) => c[0]))]).toEqual([ContainerRegistrationKeys.QUERY])
  })
})
