// The real createStep only runs inside a workflow composer, so stub the SDK
// to expose the step's invoke/compensate handlers for direct unit testing.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: unknown, invokeFn: unknown, compensateFn: unknown) =>
    Object.assign(jest.fn(), { invokeFn, compensateFn }),
  StepResponse: class StepResponse {
    constructor(
      public output: unknown,
      public compensateInput?: unknown
    ) {}
  },
}))

jest.mock("@medusajs/medusa/core-flows", () => ({
  cancelOrderWorkflow: jest.fn(),
}))

import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { validateTicketOrderStep } from "../validate-ticket-order"
import { SharedPaymentCancelRefusedError } from "../../../lib/shared-payment-cancel"

/**
 * A container whose Query answers the shared-payment guard
 * (lib/shared-payment-cancel.ts): `order_1` on collection `pay_col_1`, with
 * `others` also linked to it.
 */
const containerWithCollection = (others: string[] = []) => {
  const graph = jest.fn(async ({ entity, filters }: { entity: string; filters: Record<string, unknown> }) => {
    if (entity === "order_payment_collection" && filters.order_id) {
      return { data: [{ order_id: filters.order_id, payment_collection_id: "pay_col_1" }] }
    }
    if (entity === "order_payment_collection") {
      return {
        data: ["order_1", ...others].map((order_id) => ({ order_id, payment_collection_id: "pay_col_1" })),
      }
    }
    return { data: [] }
  })
  return {
    graph,
    container: {
      resolve: jest.fn((key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`unexpected resolve(${key})`)
      }),
    },
  }
}

const { invokeFn: invoke, compensateFn: compensate } =
  validateTicketOrderStep as unknown as {
    invokeFn: (input: any) => Promise<any>
    compensateFn: (orderId: string | null | undefined, ctx: any) => Promise<void>
  }

// metadata.show_date is a string; purchases[].show_date is a DB `Date`. The step
// normalizes both before comparing, so fixtures deliberately mix the two types.
const ticketItem = (overrides: Record<string, any> = {}) => ({
  id: "li_1",
  variant_id: "variant_1",
  quantity: 1,
  metadata: { seat_number: "A1", show_date: "2026-08-01", venue_row_id: "row_1" },
  variant: {
    id: "variant_1",
    product_id: "prod_1",
    ticket_product_variant: { purchases: [] },
  },
  ...overrides,
})

describe("validateTicketOrderStep", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("validates distinct seats and passes the order id to compensation", async () => {
    const items = [
      ticketItem({
        variant: {
          id: "variant_1",
          product_id: "prod_1",
          ticket_product_variant: {
            // A different seat being taken must not block this one
            purchases: [{ seat_number: "B1", show_date: "2026-08-01" }],
          },
        },
      }),
      ticketItem({
        id: "li_2",
        metadata: { seat_number: "A2", show_date: "2026-08-01", venue_row_id: "row_1" },
      }),
    ]

    const result = await invoke({ items, order_id: "order_1" })

    expect(result.output).toEqual({ validated: true })
    expect(result.compensateInput).toBe("order_1")
  })

  it("skips non-ticket line items without seat metadata", async () => {
    const items = [
      { id: "li_plain", variant_id: "v_plain", quantity: 1, metadata: {} },
      ticketItem({ id: "li_no_seat", metadata: {} }),
    ]

    await expect(invoke({ items, order_id: "order_1" })).resolves.toMatchObject({
      output: { validated: true },
    })
  })

  it("rejects any line item with quantity other than one", async () => {
    const items = [ticketItem({ quantity: 2 })]

    await expect(invoke({ items, order_id: "order_1" })).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "You can only purchase one ticket for a seat.",
    })
  })

  it("rejects a seated item without a show date", async () => {
    const items = [ticketItem({ metadata: { seat_number: "A1", venue_row_id: "row_1" } })]

    await expect(invoke({ items, order_id: "order_1" })).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "Show date is required for seat A1 in product prod_1",
    })
  })

  it("rejects a seated item without a venue row", async () => {
    const items = [ticketItem({ metadata: { seat_number: "A1", show_date: "2026-08-01" } })]

    await expect(invoke({ items, order_id: "order_1" })).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "Venue row is required for seat A1 in product prod_1",
    })
  })

  it("rejects duplicate seat + show date combinations within the cart", async () => {
    const items = [ticketItem(), ticketItem({ id: "li_2" })]

    await expect(invoke({ items, order_id: "order_1" })).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "Duplicate seat A1 found for show date 2026-08-01 in cart",
    })
  })

  it("allows the same seat on different show dates", async () => {
    const items = [
      ticketItem(),
      ticketItem({
        id: "li_2",
        metadata: { seat_number: "A1", show_date: "2026-08-02", venue_row_id: "row_1" },
      }),
    ]

    await expect(invoke({ items, order_id: "order_1" })).resolves.toMatchObject({
      output: { validated: true },
    })
  })

  it("rejects a seat that has already been purchased for the show date", async () => {
    const items = [
      ticketItem({
        variant: {
          id: "variant_1",
          product_id: "prod_1",
          ticket_product_variant: {
            // Stored as a DB Date — the guard must still match the string
            // metadata.show_date after normalization (previously it never did).
            purchases: [{ seat_number: "A1", show_date: new Date("2026-08-01") }],
          },
        },
      }),
    ]

    await expect(invoke({ items, order_id: "order_1" })).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "Seat A1 has already been purchased for show date 2026-08-01",
    })
  })

  it("compensation cancels the created order", async () => {
    const run = jest.fn()
    ;(cancelOrderWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const { container, graph } = containerWithCollection()
    const context = { transactionId: "tx_1" }

    await compensate("order_1", { container, context })

    // The shared-payment guard read the order's collection before the cancel ran.
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "order_payment_collection", filters: { order_id: "order_1" } })
    )
    expect(cancelOrderWorkflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({
      input: { order_id: "order_1" },
      context,
      container,
    })
  })

  it("compensation refuses, and does not cancel, when the order's payment collection is shared (SD-36 (8))", async () => {
    const run = jest.fn()
    ;(cancelOrderWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const { container } = containerWithCollection(["order_2"])

    const err = await compensate("order_1", { container, context: {} }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SharedPaymentCancelRefusedError)
    expect((err as SharedPaymentCancelRefusedError).shared_payment_collections).toEqual([
      { payment_collection_id: "pay_col_1", other_order_ids: ["order_2"] },
    ])
    expect(cancelOrderWorkflow).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it("compensation no-ops when no order id was recorded", async () => {
    await compensate(undefined, { container: {}, context: {} })

    expect(cancelOrderWorkflow).not.toHaveBeenCalled()
  })

  // SD-48 (i): the settling ticket checkout (FF_TICKET_ORDER_SETTLEMENT_V1)
  // passes `cancel_order_on_rollback: false`, so the compensation does not run
  // cancelOrderWorkflow (a refund of a captured payment, a cancel of an
  // uncaptured one, `order.canceled`).
  it("cancel_order_on_rollback false: the compensation is handed null (not the output) and cancels nothing", async () => {
    const result = await invoke({ items: [ticketItem()], order_id: "order_1", cancel_order_on_rollback: false })

    expect(result.output).toEqual({ validated: true })
    // null, not undefined: a StepResponse with no compensation input would
    // hand the (truthy) output to the compensation instead.
    expect(result.compensateInput).toBeNull()
    await compensate(result.compensateInput, { container: { resolve: jest.fn() }, context: {} })
    expect(cancelOrderWorkflow).not.toHaveBeenCalled()
  })

  it.each([[undefined], [true]])("cancel_order_on_rollback %s: the order id is handed to the compensation, as before", async (flag) => {
    const result = await invoke({ items: [ticketItem()], order_id: "order_1", cancel_order_on_rollback: flag })

    expect(result.compensateInput).toBe("order_1")
  })
})
