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
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { refreshCartAfterReprice, refreshCartPaymentCollection } from "../cart-payment-refresh"

/**
 * SD-115: what runs after a write that changed a cart's total, and after a
 * completion refused for its session's amount. Medusa's refresh, then the
 * sessions it left that are not for the total: its refresh does nothing when
 * the collection already agrees with the total, and a session opened while
 * the total was changing can still be for the old one. Then the payments
 * left without their session (SD-115 review): deleting an authorized session
 * leaves its payment on the collection, and a capture takes it.
 */

type Session = { id: string; amount: unknown; status: string }
type Payment = { id: string; payment_session_id: string | null; captured_at?: unknown; canceled_at?: unknown }
type Cart = {
  id: string
  completed_at: unknown
  currency_code: string
  total: unknown
  payment_collection: { payment_sessions: Session[]; payments?: Payment[] } | null
}

function scopeWith(cart: Cart | undefined) {
  const graph = jest.fn(async (_args: { entity: string; fields: string[]; filters: { id: string } }) => ({ data: cart ? [cart] : [] }))
  const calls: string[] = []
  // The payment module, by its registration key: anything else resolved throws.
  const payments = {
    cancelPayment: jest.fn(async (id: string) => {
      calls.push(`cancel ${id}`)
      return { id }
    }),
    softDeletePayments: jest.fn(async (ids: string[]) => {
      calls.push(`soft-delete ${ids.join(",")}`)
    }),
  }
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    if (key === Modules.PAYMENT) return payments
    throw new Error(`unexpected resolve ${key}`)
  })
  return { scope: { resolve } as unknown as MedusaContainer, graph, resolve, payments, calls }
}

const FIELDS = [
  "id",
  "completed_at",
  "currency_code",
  "total",
  "payment_collection.id",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.amount",
  "payment_collection.payment_sessions.status",
  "payment_collection.payments.id",
  "payment_collection.payments.payment_session_id",
  "payment_collection.payments.captured_at",
  "payment_collection.payments.canceled_at",
]

const cartWith = (total: unknown, sessions: Session[]): Cart => ({
  id: "cart_1",
  completed_at: null,
  currency_code: "usd",
  total,
  payment_collection: { payment_sessions: sessions },
})

/** A cart at 36 with no session left and these payments on its collection. */
const withOrphans = (payments: Payment[]): Cart => ({ ...cartWith(36, []), payment_collection: { payment_sessions: [], payments } })

beforeEach(() => {
  runs.length = 0
  failing.clear()
})

describe.each([
  ["refreshCartPaymentCollection", refreshCartPaymentCollection, "refresh-payment-collection"],
  ["refreshCartAfterReprice", refreshCartAfterReprice, "refresh-cart-items"],
] as const)("%s", (_name, settle, medusaWorkflow) => {
  it("runs Medusa's workflow for the cart, then reads the cart it left: once for its sessions, once more for its payments", async () => {
    const t = scopeWith(cartWith(34, []))
    await settle(t.scope, "cart_1")

    expect(runs).toEqual([{ workflow: medusaWorkflow, input: { cart_id: "cart_1" } }])
    expect(t.graph).toHaveBeenCalledTimes(2)
    for (const call of t.graph.mock.calls) expect(call[0]).toEqual({ entity: "cart", fields: FIELDS, filters: { id: "cart_1" } })
    // Nothing to retire, so the payment module is not touched.
    expect(t.calls).toEqual([])
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

  it("Medusa's workflow fails: it throws its error, no session is deleted, and only the payments are looked at", async () => {
    failing.set(medusaWorkflow, new Error("Failed to acquire lock for key cart_1"))
    const t = scopeWith(cartWith(19, [{ id: "payses_raced", amount: 17, status: "pending" }]))
    await expect(settle(t.scope, "cart_1")).rejects.toThrow("Failed to acquire lock")
    expect(t.graph).toHaveBeenCalledTimes(1)
    expect(runs.map((r) => r.workflow)).toEqual([medusaWorkflow])
  })

  it("the session cannot be deleted and is still there: it throws, so the caller does not report the cart as settled", async () => {
    failing.set("delete-payment-sessions", new Error("Could not delete all payment sessions"))
    const t = scopeWith(cartWith(19, [{ id: "payses_raced", amount: 17, status: "pending" }]))
    await expect(settle(t.scope, "cart_1")).rejects.toThrow("Could not delete all payment sessions")
    // The sessions, again after the failed delete, then the payments.
    expect(t.graph).toHaveBeenCalledTimes(3)
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

  it("reads through the query and, with a payment to retire, the payment module, and resolves nothing else: no ledger (Posture A)", async () => {
    const t = scopeWith(cartWith(19, [{ id: "payses_raced", amount: 17, status: "pending" }]))
    await settle(t.scope, "cart_1")
    expect([...new Set(t.resolve.mock.calls.map((c) => c[0]))]).toEqual([ContainerRegistrationKeys.QUERY])

    const orphaned = scopeWith(withOrphans([{ id: "pay_1", payment_session_id: "payses_deleted" }]))
    await settle(orphaned.scope, "cart_1")
    expect([...new Set(orphaned.resolve.mock.calls.map((c) => c[0]))]).toEqual([ContainerRegistrationKeys.QUERY, Modules.PAYMENT])
  })

  describe("the payments left without their session (SD-115 review)", () => {
    it("a payment whose session is gone and that captured nothing is cancelled, then soft-deleted, after the sessions are settled", async () => {
      const t = scopeWith(withOrphans([{ id: "pay_held", payment_session_id: "payses_deleted", captured_at: null, canceled_at: null }]))
      await settle(t.scope, "cart_1")
      expect(t.calls).toEqual(["cancel pay_held", "soft-delete pay_held"])
      expect(runs.map((r) => r.workflow)).toEqual([medusaWorkflow])
    })

    it("one Medusa already cancelled (a failed completion's compensation) is only soft-deleted", async () => {
      const t = scopeWith(withOrphans([{ id: "pay_compensated", payment_session_id: "payses_replaced", canceled_at: new Date() }]))
      await settle(t.scope, "cart_1")
      expect(t.calls).toEqual(["soft-delete pay_compensated"])
    })

    it("leaves a payment whose session remains, and one that captured", async () => {
      const t = scopeWith({
        ...cartWith(19, [{ id: "payses_live", amount: 19, status: "authorized" }]),
        payment_collection: {
          payment_sessions: [{ id: "payses_live", amount: 19, status: "authorized" }],
          payments: [
            { id: "pay_live", payment_session_id: "payses_live" },
            { id: "pay_taken", payment_session_id: "payses_deleted", captured_at: new Date() },
          ],
        },
      })
      await settle(t.scope, "cart_1")
      expect(t.calls).toEqual([])
    })

    it("a cancel the provider refuses (an intent captured at Stripe without Medusa knowing) leaves that payment on the collection, retires the others, and throws", async () => {
      const t = scopeWith(
        withOrphans([
          { id: "pay_taken_at_stripe", payment_session_id: "payses_a" },
          { id: "pay_2", payment_session_id: "payses_b" },
        ])
      )
      t.payments.cancelPayment.mockImplementationOnce(async () => {
        throw new Error("An error occurred in cancelPayment: This PaymentIntent's status is succeeded")
      })
      await expect(settle(t.scope, "cart_1")).rejects.toThrow(
        /cart cart_1: 1 payment\(s\) left without their session could not be cancelled and taken off the collection: pay_taken_at_stripe: An error occurred in cancelPayment/
      )
      expect(t.payments.softDeletePayments.mock.calls).toEqual([[["pay_2"]]])
    })

    it("still runs when Medusa's workflow failed part way, and the workflow's error is what the caller gets", async () => {
      failing.set(medusaWorkflow, new Error("Could not delete all payment sessions"))
      const t = scopeWith(withOrphans([{ id: "pay_held", payment_session_id: "payses_deleted" }]))
      await expect(settle(t.scope, "cart_1")).rejects.toThrow("Could not delete all payment sessions")
      expect(t.calls).toEqual(["cancel pay_held", "soft-delete pay_held"])
    })

    it("its own failure is reported when the rest went through", async () => {
      const t = scopeWith(withOrphans([{ id: "pay_held", payment_session_id: "payses_deleted" }]))
      t.payments.softDeletePayments.mockImplementationOnce(async () => {
        throw new Error("connection reset")
      })
      await expect(settle(t.scope, "cart_1")).rejects.toThrow("pay_held: connection reset")
    })

    it("touches nothing on a completed cart", async () => {
      const t = scopeWith({ ...withOrphans([{ id: "pay_1", payment_session_id: "payses_deleted" }]), completed_at: new Date() })
      await settle(t.scope, "cart_1")
      expect(t.calls).toEqual([])
    })
  })
})
