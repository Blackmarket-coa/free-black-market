import { MedusaError } from "@medusajs/framework/utils"
import type { CompleteCartWorkflowInput } from "@medusajs/medusa/core-flows"

/**
 * The composition registered on `completeCartWorkflow.hooks.validate`
 * (`complete-cart-guards.ts`): which guards run, in what order, and that none
 * runs on a cart that has already completed.
 *
 * SD-54 follow-up: Medusa runs the hook on every run of the workflow, before it
 * looks at the cart's existing order. On a re-run of a completed cart the
 * order-cycle guard refused (its sold count already held the cart's own sale,
 * or the cycle had closed), which failed the retry and ran the workflow's
 * refund compensation. The guards are mocked here so the spec says only what
 * the composition decides; each guard's own spec covers what it refuses, and
 * `integration-tests/http/complete-cart-validate-guards.spec.ts` re-runs the
 * real workflow on completed carts.
 */

jest.mock("../validate-sliding-scale-tier", () => ({ validateSlidingScaleTier: jest.fn() }))
jest.mock("../../rental/hooks/validate-rental", () => ({ validateRentalOnCompleteCart: jest.fn() }))
jest.mock("../validate-ccr-reservation", () => ({ validateCcrReservation: jest.fn() }))
jest.mock("../validate-order-cycle", () => ({ validateOrderCycleOnCompleteCart: jest.fn() }))
jest.mock("../validate-cart-payment-amount", () => ({ validateCartPaymentAmount: jest.fn() }))

import { runCompleteCartGuards } from "../complete-cart-guards"
import { cartAlreadyCompleted } from "../complete-cart-validate-args"
import { validateSlidingScaleTier } from "../validate-sliding-scale-tier"
import { validateRentalOnCompleteCart } from "../../rental/hooks/validate-rental"
import { validateCcrReservation } from "../validate-ccr-reservation"
import { validateOrderCycleOnCompleteCart } from "../validate-order-cycle"
import { validateCartPaymentAmount } from "../validate-cart-payment-amount"

const GUARDS = {
  "sliding-scale": jest.mocked(validateSlidingScaleTier),
  rental: jest.mocked(validateRentalOnCompleteCart),
  ccr: jest.mocked(validateCcrReservation),
  "order-cycle": jest.mocked(validateOrderCycleOnCompleteCart),
  "payment-amount": jest.mocked(validateCartPaymentAmount),
}

/** The guards that ran, in the order they were called, with what each was handed. */
function calls(): Array<{ guard: string; args: unknown; context: unknown }> {
  return Object.entries(GUARDS)
    .flatMap(([guard, fn]) =>
      fn.mock.calls.map((call, i) => ({ guard, args: call[0], context: call[1], order: fn.mock.invocationCallOrder[i] }))
    )
    .sort((a, b) => a.order - b.order)
    .map(({ guard, args, context }) => ({ guard, args, context }))
}

/** The hook's argument as Medusa passes it: `{ input, cart }`, `input` typed with Medusa's own `CompleteCartWorkflowInput`. */
type MedusaValidateArgs = { input: CompleteCartWorkflowInput; cart: unknown }

const CONTEXT = { container: { resolve: () => ({}) } }
/**
 * SD-115: the payment-amount guard is last. It is handed the context as the
 * others are: it reads the collection's payments when a session is for
 * another amount, to tell whether that payment captured.
 */
const ALL_FIVE = ["sliding-scale", "rental", "ccr", "order-cycle", "payment-amount"]

beforeEach(() => {
  for (const fn of Object.values(GUARDS)) {
    fn.mockReset()
    fn.mockResolvedValue(undefined)
  }
})

describe("runCompleteCartGuards", () => {
  it("runs all five guards, in order, on a cart that has not completed, each with the hook's own argument and its context", async () => {
    const args: MedusaValidateArgs = { input: { id: "cart_1" }, cart: { id: "cart_1", completed_at: null } }
    await runCompleteCartGuards(args, CONTEXT)
    expect(calls().map((c) => c.guard)).toEqual(ALL_FIVE)
    for (const call of calls()) {
      expect(call.args).toBe(args)
      expect(call.context).toBe(CONTEXT)
    }
  })

  it("runs all five when the hook carries no cart (nothing says it completed; the payment-amount guard refuses that itself)", async () => {
    await runCompleteCartGuards({ input: { id: "cart_1" } }, CONTEXT)
    expect(calls().map((c) => c.guard)).toEqual(ALL_FIVE)
  })

  it.each([
    ["a Date", new Date("2026-11-15T12:00:00Z")],
    ["an ISO string", "2026-11-15T12:00:00.000Z"],
  ])("runs none of them on a re-run of a cart that has completed (completed_at as %s)", async (_label, completedAt) => {
    const args: MedusaValidateArgs = { input: { id: "cart_1" }, cart: { id: "cart_1", completed_at: completedAt } }
    await expect(runCompleteCartGuards(args, CONTEXT)).resolves.toBeUndefined()
    expect(calls()).toEqual([])
  })

  it("stops at the first refusal: a guard's MedusaError is the hook's answer and the later guards do not run", async () => {
    const refusal = new MedusaError(MedusaError.Types.NOT_ALLOWED, "rental refused")
    GUARDS.rental.mockRejectedValueOnce(refusal)
    await expect(runCompleteCartGuards({ input: { id: "cart_1" }, cart: { id: "cart_1" } }, CONTEXT)).rejects.toBe(refusal)
    expect(calls().map((c) => c.guard)).toEqual(["sliding-scale", "rental"])
  })
})

describe("cartAlreadyCompleted", () => {
  it.each([
    ["a Date", { completed_at: new Date() }, true],
    ["an ISO string", { completed_at: "2026-11-15T12:00:00.000Z" }, true],
    ["null", { completed_at: null }, false],
    ["no completed_at", { id: "cart_1" }, false],
  ])("reads the hook's cart: completed_at %s", (_label, cart, expected) => {
    expect(cartAlreadyCompleted({ input: { id: "cart_1" }, cart })).toBe(expected)
  })

  it("is false when the hook carries no cart, or no argument at all", () => {
    expect(cartAlreadyCompleted({ input: { id: "cart_1" } })).toBe(false)
    expect(cartAlreadyCompleted({ input: { id: "cart_1" }, cart: null })).toBe(false)
    expect(cartAlreadyCompleted(undefined)).toBe(false)
  })
})
