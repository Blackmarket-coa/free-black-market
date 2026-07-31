// Unit tests for the checkout-gating logic composed in
// src/workflows/complete-cart-with-tickets.ts. The composer runs with the
// workflows SDK and core flows stubbed out so we can capture and exercise the
// pure pieces this workflow owns: the existing-links idempotency predicate,
// the query it gates on, and the order-link shaping transform. The gating
// execution semantics of when/then themselves belong to the framework.
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
  transform: jest.fn((_data: unknown, fn: unknown) => ({ __transform: fn })),
  // Always run the gated block so its transform/step wiring can be captured;
  // the predicate itself is asserted directly in the tests below.
  when: jest.fn((_data: unknown, _predicate: unknown) => ({
    then: (fn: () => unknown) => fn(),
  })),
}))

jest.mock("@medusajs/medusa/core-flows", () => ({
  acquireLockStep: jest.fn(),
  releaseLockStep: jest.fn(),
  createRemoteLinkStep: jest.fn(),
  cancelOrderWorkflow: jest.fn(),
  completeCartWorkflow: { runAsStep: jest.fn(() => ({ id: "order_1" })) },
  useQueryGraphStep: jest.fn(() => {
    const result: any = { data: [{ id: "stub_entity", items: [] }] }
    result.config = jest.fn(() => result)
    return result
  }),
}))

jest.mock("../../../links/ticket-purchase-order", () => ({
  __esModule: true,
  default: { entryPoint: "ticket_purchase_order" },
}))

import { Modules } from "@medusajs/framework/utils"
import { transform, when } from "@medusajs/framework/workflows-sdk"
import {
  completeCartWorkflow,
  createRemoteLinkStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { TICKET_BOOKING_MODULE } from "../../../modules/ticket-booking"
import { createTicketPurchasesStep } from "../create-ticket-purchases"
import { validateTicketOrderStep } from "../validate-ticket-order"
import { completeCartWithTicketsWorkflow } from "../../complete-cart-with-tickets"

const runComposer = () =>
  (completeCartWithTicketsWorkflow as unknown as {
    composerFn: (input: { cart_id: string }) => unknown
  }).composerFn({ cart_id: "cart_1" })

describe("completeCartWithTicketsWorkflow", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("checks existing ticket-purchase links for the completed order", () => {
    runComposer()

    expect(completeCartWorkflow.runAsStep).toHaveBeenCalledWith({
      input: { id: "cart_1" },
    })
    const linkQuery = (useQueryGraphStep as unknown as jest.Mock).mock.calls
      .map((call) => call[0])
      .find((args) => args.entity === "ticket_purchase_order")
    expect(linkQuery).toEqual({
      entity: "ticket_purchase_order",
      fields: ["ticket_purchase.id"],
      filters: { order_id: "order_1" },
    })
  })

  it("only creates purchases when the order has no existing links", () => {
    runComposer()

    const predicate = (when as unknown as jest.Mock).mock.calls[0][1]
    expect(predicate({ existingLinks: [] })).toBe(true)
    expect(
      predicate({ existingLinks: [{ ticket_purchase: { id: "tp_1" } }] })
    ).toBe(false)
  })

  it("passes the completed order id into the gated validation and purchase steps", () => {
    runComposer()

    expect(validateTicketOrderStep).toHaveBeenCalledWith({
      items: [],
      order_id: "order_1",
    })
    expect(createTicketPurchasesStep).toHaveBeenCalledWith({
      order_id: "order_1",
      cart: { id: "stub_entity", items: [] },
    })
  })

  it("links each created ticket purchase to the order", () => {
    runComposer()

    expect(createRemoteLinkStep).toHaveBeenCalled()
    const linkFn = (transform as unknown as jest.Mock).mock.calls[0][1]
    const linkData = linkFn({
      order: { id: "order_1" },
      ticketPurchases: [{ id: "tp_1" }, { id: "tp_2" }],
    })
    expect(linkData).toEqual([
      {
        [TICKET_BOOKING_MODULE]: { ticket_purchase_id: "tp_1" },
        [Modules.ORDER]: { order_id: "order_1" },
      },
      {
        [TICKET_BOOKING_MODULE]: { ticket_purchase_id: "tp_2" },
        [Modules.ORDER]: { order_id: "order_1" },
      },
    ])
  })
})
