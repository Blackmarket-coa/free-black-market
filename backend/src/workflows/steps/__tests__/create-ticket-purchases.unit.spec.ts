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

import { TICKET_BOOKING_MODULE } from "../../../modules/ticket-booking"
import { createTicketPurchasesStep } from "../create-ticket-purchases"

const { invokeFn: invoke, compensateFn: compensate } =
  createTicketPurchasesStep as unknown as {
    invokeFn: (input: any, ctx: any) => Promise<any>
    compensateFn: (purchases: any, ctx: any) => Promise<void>
  }

const makeService = (overrides: Record<string, any> = {}) => ({
  createTicketPurchases: jest.fn().mockResolvedValue([]),
  deleteTicketPurchases: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

const makeContainer = (service: any) => ({
  resolve: jest.fn().mockReturnValue(service),
})

const ticketLineItem = (overrides: Record<string, any> = {}) => ({
  id: "li_1",
  metadata: { venue_row_id: "row_1", seat_number: "A1" },
  variant: {
    ticket_product_variant: { id: "tpv_1", ticket_product_id: "tprod_1" },
    options: [
      { value: "Balcony", option: { title: "Row Type" } },
      { value: "2026-08-01", option: { title: "Date" } },
    ],
  },
  ...overrides,
})

describe("createTicketPurchasesStep", () => {
  it("creates one purchase per ticket line item, dated from the variant Date option", async () => {
    const created = [{ id: "tp_1" }]
    const service = makeService({
      createTicketPurchases: jest.fn().mockResolvedValue(created),
    })
    const container = makeContainer(service)
    const cart = {
      id: "cart_1",
      items: [
        // Non-ticket items in the same cart are ignored
        { id: "li_plain", metadata: {}, variant: undefined },
        ticketLineItem(),
      ],
    }

    const result = await invoke({ order_id: "order_1", cart }, { container })

    expect(container.resolve).toHaveBeenCalledWith(TICKET_BOOKING_MODULE)
    expect(service.createTicketPurchases).toHaveBeenCalledWith([
      {
        order_id: "order_1",
        ticket_product_id: "tprod_1",
        ticket_variant_id: "tpv_1",
        venue_row_id: "row_1",
        seat_number: "A1",
        show_date: new Date("2026-08-01"),
      },
    ])
    expect(result.output).toBe(created)
    expect(result.compensateInput).toBe(created)
  })

  it("skips items whose variant has no ticket_product_variant link", async () => {
    const service = makeService()
    const item = ticketLineItem({
      variant: { options: [{ value: "2026-08-01", option: { title: "Date" } }] },
    })

    await invoke(
      { order_id: "order_1", cart: { id: "cart_1", items: [item] } },
      { container: makeContainer(service) }
    )

    expect(service.createTicketPurchases).toHaveBeenCalledWith([])
  })

  it("skips items missing venue_row_id metadata", async () => {
    const service = makeService()
    const item = ticketLineItem({ metadata: { seat_number: "A1" } })

    await invoke(
      { order_id: "order_1", cart: { id: "cart_1", items: [item] } },
      { container: makeContainer(service) }
    )

    expect(service.createTicketPurchases).toHaveBeenCalledWith([])
  })

  it("skips items missing seat_number metadata", async () => {
    const service = makeService()
    const item = ticketLineItem({ metadata: { venue_row_id: "row_1" } })

    await invoke(
      { order_id: "order_1", cart: { id: "cart_1", items: [item] } },
      { container: makeContainer(service) }
    )

    expect(service.createTicketPurchases).toHaveBeenCalledWith([])
  })

  it("still creates a purchase with an invalid show_date when the variant has no Date option", async () => {
    // Documents current behavior: a missing "Date" option is not rejected,
    // it yields new Date(undefined) — an Invalid Date.
    const service = makeService()
    const item = ticketLineItem({
      variant: {
        ticket_product_variant: { id: "tpv_1", ticket_product_id: "tprod_1" },
        options: [{ value: "Balcony", option: { title: "Row Type" } }],
      },
    })

    await invoke(
      { order_id: "order_1", cart: { id: "cart_1", items: [item] } },
      { container: makeContainer(service) }
    )

    const [toCreate] = service.createTicketPurchases.mock.calls[0]
    expect(toCreate).toHaveLength(1)
    expect(Number.isNaN(toCreate[0].show_date.getTime())).toBe(true)
  })

  it("compensation deletes the created purchases", async () => {
    const service = makeService()
    const container = makeContainer(service)

    await compensate([{ id: "tp_1" }, { id: "tp_2" }], { container })

    expect(service.deleteTicketPurchases).toHaveBeenCalledWith(["tp_1", "tp_2"])
  })

  it("compensation no-ops when no purchases were created", async () => {
    const container = makeContainer(makeService())

    await compensate(undefined, { container })

    expect(container.resolve).not.toHaveBeenCalled()
  })
})
