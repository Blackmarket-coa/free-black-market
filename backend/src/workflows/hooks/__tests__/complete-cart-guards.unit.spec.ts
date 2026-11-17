import { MedusaError } from "@medusajs/framework/utils"
import type { CompleteCartWorkflowInput } from "@medusajs/medusa/core-flows"

/**
 * The composition registered on `completeCartWorkflow.hooks.validate`
 * (`complete-cart-guards.ts`): which guards run, in what order, and that none
 * runs on a cart that has already completed. And the main checkout's list,
 * which the middleware in front of Mercur's `POST /store/carts/:id/complete`
 * runs (`api/middlewares/cart-completion-guards.ts`): the same list less the
 * guards excluded there by name, each with its reason.
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

import {
  COMPLETE_CART_GUARDS,
  MAIN_CHECKOUT_GUARDS,
  NOT_RUN_ON_MAIN_CHECKOUT,
  runCompleteCartGuards,
  runMainCheckoutGuards,
} from "../complete-cart-guards"
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

/**
 * The main checkout (SD-54, SD-72 (a)). Mercur's `splitAndCompleteCartWorkflow`
 * never calls Medusa's validate hook, so a middleware in front of its route
 * runs `runMainCheckoutGuards`. One list feeds both seams: the main checkout's
 * is `COMPLETE_CART_GUARDS` less the names in `NOT_RUN_ON_MAIN_CHECKOUT`. The
 * exact names are pinned below, so a guard added to the full list fails here
 * until whoever adds it decides, in this file, whether it runs at the main
 * checkout (add it to `MAIN_THREE`) or not (give it a reason in
 * `NOT_RUN_ON_MAIN_CHECKOUT`).
 */
const MAIN_THREE = ["sliding-scale", "ccr", "order-cycle"]

describe("the guard lists", () => {
  it("lists every guard once, in the hook's order", () => {
    expect(COMPLETE_CART_GUARDS.map((g) => g.name)).toEqual([
      "sliding-scale-tier",
      "rental",
      "ccr-reservation",
      "order-cycle",
      "payment-amount",
    ])
  })

  it("the main checkout runs the tier, Coalition Credits and order-cycle guards, and no other", () => {
    expect(MAIN_CHECKOUT_GUARDS.map((g) => g.name)).toEqual(["sliding-scale-tier", "ccr-reservation", "order-cycle"])
  })

  it("leaves out exactly the rental guard (operator decision pending) and the payment-amount guard (its own middleware on that route), each with a reason", () => {
    expect(Object.keys(NOT_RUN_ON_MAIN_CHECKOUT)).toEqual(["rental", "payment-amount"])
    expect(NOT_RUN_ON_MAIN_CHECKOUT.rental).toMatch(/decision/i)
    expect(NOT_RUN_ON_MAIN_CHECKOUT["payment-amount"]).toMatch(/refuseCompletionOnPaymentAmountMismatch/)
    // An exclusion names a guard that exists: a renamed guard would otherwise
    // slip back onto the main checkout with its stale exclusion left behind.
    const names = COMPLETE_CART_GUARDS.map((g) => g.name as string)
    for (const name of Object.keys(NOT_RUN_ON_MAIN_CHECKOUT)) expect(names).toContain(name)
  })

  it("is one list: the main checkout's entries are the full list's own, in its order, less the exclusions", () => {
    expect(MAIN_CHECKOUT_GUARDS).toEqual(COMPLETE_CART_GUARDS.filter((g) => !(g.name in NOT_RUN_ON_MAIN_CHECKOUT)))
    for (const guard of MAIN_CHECKOUT_GUARDS) expect(COMPLETE_CART_GUARDS).toContain(guard)
  })
})

describe("runMainCheckoutGuards", () => {
  it("runs the three, in order, on a cart that has not completed, each with the middleware's argument and its context; never the rental or payment-amount guard", async () => {
    const args: MedusaValidateArgs = { input: { id: "cart_1" }, cart: { id: "cart_1", completed_at: null } }
    await runMainCheckoutGuards(args, CONTEXT)
    expect(calls().map((c) => c.guard)).toEqual(MAIN_THREE)
    for (const call of calls()) {
      expect(call.args).toBe(args)
      expect(call.context).toBe(CONTEXT)
    }
    expect(GUARDS.rental).not.toHaveBeenCalled()
    expect(GUARDS["payment-amount"]).not.toHaveBeenCalled()
  })

  it("runs none of them on a cart that has completed (the same check as the hook's)", async () => {
    const args: MedusaValidateArgs = { input: { id: "cart_1" }, cart: { id: "cart_1", completed_at: "2026-11-17T12:00:00.000Z" } }
    await expect(runMainCheckoutGuards(args, CONTEXT)).resolves.toBeUndefined()
    expect(calls()).toEqual([])
  })

  it("stops at the first refusal and hands it back", async () => {
    const refusal = new MedusaError(MedusaError.Types.NOT_ALLOWED, "ccr refused")
    GUARDS.ccr.mockRejectedValueOnce(refusal)
    await expect(runMainCheckoutGuards({ input: { id: "cart_1" }, cart: { id: "cart_1", completed_at: null } }, CONTEXT)).rejects.toBe(refusal)
    expect(calls().map((c) => c.guard)).toEqual(["sliding-scale", "ccr"])
  })
})
