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

import { MedusaError } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { validateTicketOrderStep } from "../validate-ticket-order"

const { invokeFn: invoke, compensateFn: compensate } =
  validateTicketOrderStep as unknown as {
    invokeFn: (input: any) => Promise<any>
    compensateFn: (orderId: string | undefined, ctx: any) => Promise<void>
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
    const container = { resolve: jest.fn() }
    const context = { transactionId: "tx_1" }

    await compensate("order_1", { container, context })

    expect(cancelOrderWorkflow).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({
      input: { order_id: "order_1" },
      context,
      container,
    })
  })

  it("compensation no-ops when no order id was recorded", async () => {
    await compensate(undefined, { container: {}, context: {} })

    expect(cancelOrderWorkflow).not.toHaveBeenCalled()
  })
})
