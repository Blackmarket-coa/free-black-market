// The guard makes its logger when its module loads, which jest hoists above
// this const; the indirection defers the reference until a line is logged.
const logError = jest.fn()
jest.mock("../../../shared/logger", () => ({
  createLogger: () => ({ error: (...args: unknown[]) => logError(...args), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}))

import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE,
  CART_PAYMENT_AMOUNT_MISMATCH,
  CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE,
  CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE,
  CartPaymentAmountError,
} from "../../../lib/cart-payment-amount"
import { validateCartPaymentAmount } from "../validate-cart-payment-amount"

/**
 * SD-115 review: the payment-amount guard on `completeCartWorkflow.hooks.validate`,
 * the refusal for every completion that is not Mercur's (the ticket, digital,
 * rental and subscription checkouts, the hosted pages, renewals and Medusa's
 * payment webhook). It judges the cart the workflow handed the hook; the
 * decision itself is `judgeCartPaymentAmount`'s, covered in
 * `lib/__tests__/cart-payment-amount.unit.spec.ts`. Here: that the hook's own
 * cart is what is judged, what is thrown, and what is logged.
 * `integration-tests/http/cart-payment-refresh.spec.ts` drives it through
 * each store route and the webhook's workflow on Postgres.
 */

type Session = { id: string; amount: unknown; status: string }
type Payment = { id: string; payment_session_id: string | null; captured_at?: unknown; canceled_at?: unknown }
// The cart as `completeCartFields` serve it: the collection and its sessions, not its payments.
const hookArgs = (total: unknown, sessions: Session[], cart: Record<string, unknown> = {}) => ({
  input: { id: "cart_1" },
  cart: {
    id: "cart_1",
    completed_at: null,
    currency_code: "usd",
    total,
    payment_collection: { id: "pay_col_1", payment_sessions: sessions },
    ...cart,
  },
})

/** The hook's context, its query serving these payments; anything but the query resolved throws. */
function contextWith(payments: Payment[] | "throws" = []) {
  const graph = jest.fn(async (_args: { entity: string; fields: string[]; filters: Record<string, unknown> }) => {
    if (payments === "throws") throw new Error("query unavailable")
    return { data: payments }
  })
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected resolve ${key}`)
  })
  return { context: { container: { resolve } }, graph, resolve }
}

async function refusalOf(
  args: Parameters<typeof validateCartPaymentAmount>[0],
  context: Parameters<typeof validateCartPaymentAmount>[1] = contextWith().context
): Promise<CartPaymentAmountError> {
  try {
    await validateCartPaymentAmount(args, context)
  } catch (error) {
    return error as CartPaymentAmountError
  }
  throw new Error("expected the guard to refuse")
}

beforeEach(() => logError.mockClear())

describe("validateCartPaymentAmount", () => {
  it("lets a cart through whose session is for its total, whatever status the completion accepts it in, and reads nothing more", async () => {
    const t = contextWith()
    for (const status of ["pending", "requires_more", "authorized", "captured"]) {
      await expect(validateCartPaymentAmount(hookArgs(19, [{ id: "payses_1", amount: 19, status }]), t.context)).resolves.toBeUndefined()
    }
    expect(t.graph).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })

  it("lets through what the decision passes on: no session to pay with, nothing owed, a completed cart", async () => {
    await expect(validateCartPaymentAmount(hookArgs(19, []))).resolves.toBeUndefined()
    await expect(validateCartPaymentAmount(hookArgs(0, [{ id: "payses_1", amount: 15, status: "pending" }]))).resolves.toBeUndefined()
    await expect(
      validateCartPaymentAmount(hookArgs(19, [{ id: "payses_1", amount: 15, status: "pending" }], { completed_at: new Date() }))
    ).resolves.toBeUndefined()
  })

  it("refuses a session for another amount with not_allowed, the stable code and the buyer's message, and logs both amounts with the cart", async () => {
    const t = contextWith()
    const error = await refusalOf(hookArgs(19, [{ id: "payses_1", amount: 15, status: "pending" }]), t.context)
    // Whether its payment captured is read before the answer is chosen.
    expect(t.graph).toHaveBeenCalledWith({
      entity: "payment",
      fields: ["id", "payment_session_id", "captured_at", "canceled_at"],
      filters: { payment_collection_id: "pay_col_1" },
    })
    expect(error).toBeInstanceOf(CartPaymentAmountError)
    expect(error).toBeInstanceOf(MedusaError)
    expect(error.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(error.code).toBe(CART_PAYMENT_AMOUNT_MISMATCH)
    expect(error.reason).toBe("session_amount_mismatch")
    expect(error.message).toBe(CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE)
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("cart cart_1: pending session payses_1 is for 1500 and the cart's total is 1900"),
      { cart_id: "cart_1", reason: "session_amount_mismatch" }
    )
  })

  it("refuses an authorized session for another amount the same way: the order would be recorded on its payment at the cart's total", async () => {
    const payments = [{ id: "pay_1", payment_session_id: "payses_1", captured_at: null }]
    const error = await refusalOf(hookArgs(36, [{ id: "payses_1", amount: 32, status: "authorized" }]), contextWith(payments).context)
    expect(error.reason).toBe("session_amount_mismatch")
    expect(error.message).toBe(CART_PAYMENT_AMOUNT_MISMATCH_MESSAGE)
  })

  it("an authorized session whose payment captured (Medusa stores a session captured at authorization as authorized) is refused as captured: its message does not say the card was not charged", async () => {
    const payments = [
      { id: "pay_1", payment_session_id: "payses_1", captured_at: new Date() },
      { id: "pay_other", payment_session_id: "payses_gone", captured_at: null },
    ]
    const error = await refusalOf(hookArgs(36, [{ id: "payses_1", amount: 32, status: "authorized" }]), contextWith(payments).context)
    expect(error.reason).toBe("captured_amount_mismatch")
    expect(error.message).toBe(CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("authorized session payses_1 is for 3200"), {
      cart_id: "cart_1",
      reason: "captured_amount_mismatch",
    })
  })

  it("when whether it captured cannot be read, the refusal claims least: no context, no collection id, or a failed read", async () => {
    const stale = [{ id: "payses_1", amount: 32, status: "authorized" }]
    for (const [args, context] of [
      [hookArgs(36, stale), undefined],
      [hookArgs(36, stale), {}],
      [hookArgs(36, stale, { payment_collection: { payment_sessions: stale } }), contextWith().context],
      [hookArgs(36, stale), contextWith("throws").context],
    ] as const) {
      // Called directly: refusalOf's default would stand in for an absent context.
      const error = await validateCartPaymentAmount(args, context).then(
        () => {
          throw new Error("expected the guard to refuse")
        },
        (thrown: CartPaymentAmountError) => thrown
      )
      expect(error.reason).toBe("amount_unknown")
      expect(error.message).toBe(CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE)
    }
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("whether its payment captured could not be read: query unavailable"), {
      cart_id: "cart_1",
      reason: "amount_unknown",
    })
  })

  it("refuses a captured session for another amount with the message that does not say the card was not charged", async () => {
    const error = await refusalOf(hookArgs(36, [{ id: "payses_1", amount: 32, status: "captured" }]))
    expect(error.reason).toBe("captured_amount_mismatch")
    expect(error.message).toBe(CART_PAYMENT_AMOUNT_CAPTURED_MESSAGE)
  })

  it("closed on doubt: a hook handed no cart, or a cart whose amounts cannot be compared, is refused", async () => {
    for (const args of [{ input: { id: "cart_1" } }, { input: { id: "cart_1" }, cart: null }, hookArgs(null, [{ id: "payses_1", amount: 15, status: "pending" }])]) {
      const error = await refusalOf(args)
      expect(error.reason).toBe("amount_unknown")
      expect(error.message).toBe(CART_PAYMENT_AMOUNT_UNCONFIRMED_MESSAGE)
    }
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("the completion handed the guard no cart"), {
      cart_id: "cart_1",
      reason: "amount_unknown",
    })
  })

  it("names the workflow's cart id in the log when the hook's cart carries none", async () => {
    const args = hookArgs(19, [{ id: "payses_1", amount: 15, status: "pending" }], { id: undefined })
    await refusalOf(args)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("cart cart_1: pending session payses_1"), {
      cart_id: "cart_1",
      reason: "session_amount_mismatch",
    })
  })
})
