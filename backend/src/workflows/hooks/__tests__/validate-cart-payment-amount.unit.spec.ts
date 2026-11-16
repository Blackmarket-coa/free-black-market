// The guard makes its logger when its module loads, which jest hoists above
// this const; the indirection defers the reference until a line is logged.
const logError = jest.fn()
jest.mock("../../../shared/logger", () => ({
  createLogger: () => ({ error: (...args: unknown[]) => logError(...args), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}))

import { MedusaError } from "@medusajs/framework/utils"
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
const hookArgs = (total: unknown, sessions: Session[], cart: Record<string, unknown> = {}) => ({
  input: { id: "cart_1" },
  cart: { id: "cart_1", completed_at: null, currency_code: "usd", total, payment_collection: { payment_sessions: sessions }, ...cart },
})

async function refusalOf(args: Parameters<typeof validateCartPaymentAmount>[0]): Promise<CartPaymentAmountError> {
  try {
    await validateCartPaymentAmount(args)
  } catch (error) {
    return error as CartPaymentAmountError
  }
  throw new Error("expected the guard to refuse")
}

beforeEach(() => logError.mockClear())

describe("validateCartPaymentAmount", () => {
  it("lets a cart through whose session is for its total, whatever status the completion accepts it in", async () => {
    for (const status of ["pending", "requires_more", "authorized", "captured"]) {
      await expect(validateCartPaymentAmount(hookArgs(19, [{ id: "payses_1", amount: 19, status }]))).resolves.toBeUndefined()
    }
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
    const error = await refusalOf(hookArgs(19, [{ id: "payses_1", amount: 15, status: "pending" }]))
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
    const error = await refusalOf(hookArgs(36, [{ id: "payses_1", amount: 32, status: "authorized" }]))
    expect(error.reason).toBe("session_amount_mismatch")
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
