// Unit tests for the composition of src/workflows/complete-cart-with-tickets.ts.
// The composer runs with the workflows SDK and core flows stubbed out: each
// step is a jest.fn returning a canned output, `transform` runs its function on
// what it is handed straight away, and `when` runs its block only when its
// predicate holds on that data. So one composer run reads like one checkout,
// and the tests can see which steps it calls, with what, and in what order.
// The real-database behaviour (the flag, Stripe, the ledger) is in
// integration-tests/http/ticket-order-settlement.spec.ts.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createWorkflow: (name: unknown, composerFn: unknown) => ({ name, composerFn }),
  createStep: (_name: unknown, invokeFn: unknown, compensateFn: unknown) =>
    Object.assign(jest.fn(), { invokeFn, compensateFn }),
  StepResponse: class StepResponse {
    constructor(
      public output: unknown,
      public compensateInput?: unknown
    ) {}
  },
  WorkflowResponse: class WorkflowResponse {
    constructor(public result: unknown) {}
  },
  transform: jest.fn((data: unknown, fn: (d: unknown) => unknown) => fn(data)),
  when: jest.fn((...args: unknown[]) => {
    const [data, predicate] = (args.length === 3 ? args.slice(1) : args) as [unknown, (d: unknown) => boolean]
    return { then: (fn: () => unknown) => (predicate(data) ? fn() : undefined) }
  }),
}))

jest.mock("@medusajs/medusa/core-flows", () => ({
  acquireLockStep: jest.fn(),
  releaseLockStep: jest.fn(),
  createRemoteLinkStep: jest.fn(),
  cancelOrderWorkflow: jest.fn(),
  capturePaymentWorkflow: { runAsStep: jest.fn() },
  completeCartWorkflow: { runAsStep: jest.fn(() => ({ id: "order_1" })) },
  useQueryGraphStep: jest.fn(),
}))

jest.mock("../../../links/ticket-purchase-order", () => ({
  __esModule: true,
  default: { entryPoint: "ticket_purchase_order" },
}))

// SD-53: the shared completion guard is a step like the others; captured so
// its place in the composition can be asserted.
jest.mock("../require-completed-cart-order", () => ({
  requireCompletedCartOrderStep: jest.fn(),
}))

// SD-48 (i): the shared settlement steps, as the ticket checkout calls them.
jest.mock("../../subscription/steps/subscription-order-settlement", () => ({
  ticketCheckoutModeStep: jest.fn(),
  ticketCompletedCartOrderStep: jest.fn(),
  resolveTicketSellerStep: jest.fn(),
  linkTicketOrderSellerStep: jest.fn(),
  ticketPaymentToCaptureStep: jest.fn(),
  ticketOrderPaidStep: jest.fn(),
}))

// SD-48 (i) review: the seat-line check, flag-dark in its own module.
jest.mock("../require-seated-ticket-cart", () => ({
  requireSeatedTicketCartStep: jest.fn(),
}))

jest.mock("../create-ticket-purchases", () => ({
  createTicketPurchasesStep: jest.fn(),
}))

jest.mock("../validate-ticket-order", () => ({
  validateTicketOrderStep: jest.fn(),
}))

import { Modules } from "@medusajs/framework/utils"
import { when } from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  capturePaymentWorkflow,
  completeCartWorkflow,
  createRemoteLinkStep,
  releaseLockStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { TICKET_BOOKING_MODULE } from "../../../modules/ticket-booking"
import { createTicketPurchasesStep } from "../create-ticket-purchases"
import { requireCompletedCartOrderStep } from "../require-completed-cart-order"
import { requireSeatedTicketCartStep } from "../require-seated-ticket-cart"
import { validateTicketOrderStep } from "../validate-ticket-order"
import {
  linkTicketOrderSellerStep,
  resolveTicketSellerStep,
  ticketCheckoutModeStep,
  ticketCompletedCartOrderStep,
  ticketOrderPaidStep,
  ticketPaymentToCaptureStep,
} from "../../subscription/steps/subscription-order-settlement"
import { completeCartWithTicketsWorkflow } from "../../complete-cart-with-tickets"

const mock = (fn: unknown) => fn as jest.Mock
const order = (fn: unknown, n = 0) => mock(fn).mock.invocationCallOrder[n]

const runComposer = () =>
  (completeCartWithTicketsWorkflow as unknown as {
    composerFn: (input: { cart_id: string }) => { result: { order: unknown } }
  }).composerFn({ cart_id: "cart_1" })

/** One checkout's world: the cart's order already there (a replay) or not, its ticket purchases, the payment to capture. */
function world(
  opts: { completedInto?: string | null; ticketLinks?: unknown[]; paymentToCapture?: string | null; settle?: boolean } = {}
) {
  mock(ticketCheckoutModeStep).mockReturnValue(
    opts.settle ? { settle: true, timeout: 30, ttl: 120 } : { settle: false, timeout: 2, ttl: 10 }
  )
  mock(ticketCompletedCartOrderStep).mockReturnValue({ order_id: opts.completedInto ?? null })
  mock(resolveTicketSellerStep).mockReturnValue({ seller_id: "sel_1" })
  mock(linkTicketOrderSellerStep).mockReturnValue({ linked: true, seller_id: "sel_1" })
  mock(ticketPaymentToCaptureStep).mockReturnValue({ payment_id: opts.paymentToCapture === undefined ? "pay_1" : opts.paymentToCapture })
  mock(createTicketPurchasesStep).mockReturnValue([{ id: "tp_1" }, { id: "tp_2" }])
  mock(useQueryGraphStep).mockImplementation((q: { entity: string }) => {
    const data =
      q.entity === "ticket_purchase_order"
        ? opts.ticketLinks ?? []
        : q.entity === "cart"
          ? [{ id: "cart_1", items: [] }]
          : [{ id: "refetched" }]
    const result: { data: unknown; config?: jest.Mock } = { data }
    result.config = jest.fn(() => result)
    return result
  })
}

const queryOf = (entity: string) =>
  mock(useQueryGraphStep).mock.calls.map((call) => call[0]).find((args) => args.entity === entity)

describe("completeCartWithTicketsWorkflow", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    world()
  })

  it("takes the cart lock the mode step chooses for the flag, before anything else, and releases it last", () => {
    runComposer()

    expect(acquireLockStep).toHaveBeenCalledWith({ key: "cart_1", timeout: 2, ttl: 10 })
    expect(order(ticketCheckoutModeStep)).toBeLessThan(order(acquireLockStep))
    expect(order(acquireLockStep)).toBeLessThan(order(ticketCompletedCartOrderStep))
    expect(releaseLockStep).toHaveBeenCalledWith({ key: "cart_1" })
    expect(order(createRemoteLinkStep)).toBeLessThan(order(releaseLockStep))
  })

  it("a cart not completed yet: its seller is resolved before Medusa's completion, and the SD-53 guard follows the completion before any read", () => {
    runComposer()

    expect(ticketCompletedCartOrderStep).toHaveBeenCalledWith({ cart_id: "cart_1" })
    expect(resolveTicketSellerStep).toHaveBeenCalledWith({ cart_id: "cart_1" })
    expect(completeCartWorkflow.runAsStep).toHaveBeenCalledWith({ input: { id: "cart_1" } })
    const guard = mock(requireCompletedCartOrderStep)
    expect(guard).toHaveBeenCalledTimes(1)
    expect(guard).toHaveBeenCalledWith({ cart_id: "cart_1", order_id: "order_1" })
    expect(order(ticketCompletedCartOrderStep)).toBeLessThan(order(resolveTicketSellerStep))
    expect(order(resolveTicketSellerStep)).toBeLessThan(order(completeCartWorkflow.runAsStep))
    expect(order(completeCartWorkflow.runAsStep)).toBeLessThan(order(guard))
    expect(order(guard)).toBeLessThan(order(useQueryGraphStep))
    // The replay gate is the block's own predicate.
    const gate = mock(when).mock.calls.find((call) => call[0] === "complete-ticket-cart")!
    expect(gate[2]({ completed: { order_id: null } })).toBe(true)
    expect(gate[2]({ completed: { order_id: "order_9" } })).toBe(false)
  })

  it("checks every line is one seat after the lock and before the seller check and Medusa's completion (so before the card is authorized), and on a replay before the link and the capture", () => {
    runComposer()

    const seated = mock(requireSeatedTicketCartStep)
    expect(seated).toHaveBeenCalledTimes(1)
    expect(seated).toHaveBeenCalledWith({ cart_id: "cart_1" })
    expect(order(acquireLockStep)).toBeLessThan(order(seated))
    expect(order(seated)).toBeLessThan(order(resolveTicketSellerStep))
    expect(order(seated)).toBeLessThan(order(completeCartWorkflow.runAsStep))

    jest.clearAllMocks()
    world({ completedInto: "order_9", ticketLinks: [{ ticket_purchase: { id: "tp_1" } }] })
    runComposer()
    // A replay of an order whose seats are already sold skips the seat check,
    // not this one.
    expect(validateTicketOrderStep).not.toHaveBeenCalled()
    expect(seated).toHaveBeenCalledWith({ cart_id: "cart_1" })
    expect(order(seated)).toBeLessThan(order(linkTicketOrderSellerStep))
    expect(order(seated)).toBeLessThan(order(ticketPaymentToCaptureStep))
    expect(order(seated)).toBeLessThan(order(capturePaymentWorkflow.runAsStep))
  })

  it("links the order just made to the seller checked before payment, and asks for its payment in the initial mode", () => {
    runComposer()

    expect(linkTicketOrderSellerStep).toHaveBeenCalledWith({ order_id: "order_1", mode: "initial", expected_seller_id: "sel_1" })
    expect(ticketPaymentToCaptureStep).toHaveBeenCalledWith({ order_id: "order_1", mode: "initial", linked_seller_id: "sel_1" })
    expect(ticketOrderPaidStep).toHaveBeenCalledWith({ cart_id: "cart_1", order_id: "order_1" })
  })

  it("a replay (the cart's order found) skips the seller check, the completion and the guard, and settles the order found in replay mode", () => {
    world({ completedInto: "order_9" })
    runComposer()

    expect(resolveTicketSellerStep).not.toHaveBeenCalled()
    expect(completeCartWorkflow.runAsStep).not.toHaveBeenCalled()
    expect(requireCompletedCartOrderStep).not.toHaveBeenCalled()
    expect(ticketOrderPaidStep).toHaveBeenCalledWith({ cart_id: "cart_1", order_id: "order_9" })
    expect(linkTicketOrderSellerStep).toHaveBeenCalledWith({ order_id: "order_9", mode: "replay", expected_seller_id: null })
    expect(ticketPaymentToCaptureStep).toHaveBeenCalledWith({ order_id: "order_9", mode: "replay", linked_seller_id: "sel_1" })
    expect(queryOf("ticket_purchase_order")!.filters).toEqual({ order_id: "order_9" })
  })

  it("the paid check, the seat check, the seller link, the payment's choice and the seats (purchases and their links) all come before the capture, in that order; only the refetch and the release after it", () => {
    runComposer()

    expect(capturePaymentWorkflow.runAsStep).toHaveBeenCalledWith({ input: { payment_id: "pay_1" } })
    const sequence = [
      order(ticketOrderPaidStep),
      order(validateTicketOrderStep),
      order(linkTicketOrderSellerStep),
      order(ticketPaymentToCaptureStep),
      order(createTicketPurchasesStep),
      order(createRemoteLinkStep),
      order(capturePaymentWorkflow.runAsStep),
      // The order's refetch: the third and last query.
      order(useQueryGraphStep, 2),
      order(releaseLockStep),
    ]
    expect(sequence.every((n) => typeof n === "number")).toBe(true)
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b))
    expect(queryOf("order")).toBe(mock(useQueryGraphStep).mock.calls[2][0])
    expect(validateTicketOrderStep).toHaveBeenCalledWith({ items: [], order_id: "order_1", cancel_order_on_rollback: true, seats_only: false })
    expect(createTicketPurchasesStep).toHaveBeenCalledWith({ order_id: "order_1", cart: { id: "cart_1", items: [] } })
  })

  it.each<[string, { completedInto?: string }]>([
    ["a first checkout", {}],
    ["a replay", { completedInto: "order_9" }],
  ])("settling (flag on), %s: the seat check's compensation is told not to cancel the order, and the check to refuse any line that is not one seat; flag off neither, as before", (_label, opts) => {
    world({ ...opts, settle: true })
    runComposer()
    const orderId = opts.completedInto ?? "order_1"
    expect(acquireLockStep).toHaveBeenCalledWith({ key: "cart_1", timeout: 30, ttl: 120 })
    expect(validateTicketOrderStep).toHaveBeenCalledWith({ items: [], order_id: orderId, cancel_order_on_rollback: false, seats_only: true })

    jest.clearAllMocks()
    world({ ...opts, settle: false })
    runComposer()
    expect(validateTicketOrderStep).toHaveBeenCalledWith({ items: [], order_id: orderId, cancel_order_on_rollback: true, seats_only: false })
  })

  it("captures nothing when the capture step picked no payment (flag off, or already captured)", () => {
    world({ paymentToCapture: null })
    runComposer()

    expect(capturePaymentWorkflow.runAsStep).not.toHaveBeenCalled()
    expect(createTicketPurchasesStep).toHaveBeenCalledTimes(1)
  })

  it("checks existing ticket-purchase links for the completed order", () => {
    runComposer()

    expect(queryOf("ticket_purchase_order")).toEqual({
      entity: "ticket_purchase_order",
      fields: ["ticket_purchase.id"],
      filters: { order_id: "order_1" },
    })
    expect(queryOf("order")!.filters).toEqual({ id: "order_1" })
  })

  it("an order that already has its ticket purchases is neither validated nor sold again, but still goes through the link and the capture step", () => {
    world({ completedInto: "order_9", ticketLinks: [{ ticket_purchase: { id: "tp_1" } }] })
    runComposer()

    expect(validateTicketOrderStep).not.toHaveBeenCalled()
    expect(createTicketPurchasesStep).not.toHaveBeenCalled()
    expect(createRemoteLinkStep).not.toHaveBeenCalled()
    expect(linkTicketOrderSellerStep).toHaveBeenCalledTimes(1)
    expect(ticketPaymentToCaptureStep).toHaveBeenCalledTimes(1)
    expect(capturePaymentWorkflow.runAsStep).toHaveBeenCalledWith({ input: { payment_id: "pay_1" } })
  })

  it("links each created ticket purchase to the order, and returns the refetched order", () => {
    const { result } = runComposer()

    expect(createRemoteLinkStep).toHaveBeenCalledWith([
      {
        [TICKET_BOOKING_MODULE]: { ticket_purchase_id: "tp_1" },
        [Modules.ORDER]: { order_id: "order_1" },
      },
      {
        [TICKET_BOOKING_MODULE]: { ticket_purchase_id: "tp_2" },
        [Modules.ORDER]: { order_id: "order_1" },
      },
    ])
    expect(result).toEqual({ order: { id: "refetched" } })
  })
})
