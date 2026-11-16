// The real createStep only runs inside a workflow composer, so stub the SDK
// to expose the step's invoke handler for direct unit testing.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (stepName: unknown, invokeFn: unknown, compensateFn: unknown) =>
    Object.assign(jest.fn(), { stepName, invokeFn, compensateFn }),
  StepResponse: class StepResponse {
    constructor(
      public output: unknown,
      public compensateInput?: unknown
    ) {}
  },
}))

import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import {
  requireSeatedTicketCartStep,
  unseatedTicketLineReason,
  unseatedTicketLines,
} from "../require-seated-ticket-cart"

/**
 * SD-48 (i) review: with FF_TICKET_ORDER_SETTLEMENT_V1 on, the ticket
 * checkout refuses, before Medusa authorizes the card, a cart holding any
 * line that is not one seat — the lines it would capture and sell nothing
 * for. Flag off, the step reads nothing. The real-database behaviour is in
 * integration-tests/http/ticket-order-settlement.spec.ts.
 */

const TICKETS = PHASE0_FEATURE_FLAGS.TICKET_ORDER_SETTLEMENT_V1
const DIGITAL = PHASE0_FEATURE_FLAGS.DIGITAL_ORDER_SETTLEMENT_V1
const SUBS = PHASE0_FEATURE_FLAGS.CONSUMER_SUBSCRIPTIONS_V1

const step = requireSeatedTicketCartStep as unknown as {
  stepName: string
  invokeFn: (input: { cart_id: string }, ctx: { container: unknown }) => Promise<{ output: unknown }>
  compensateFn?: unknown
}

/** One seat, as the storefront's seat picker puts it in the cart. */
const seat = (overrides: Record<string, unknown> = {}) => ({
  id: "li_seat",
  quantity: 1,
  metadata: { venue_row_id: "row_1", seat_number: "7", show_date: "2027-03-14" },
  variant: { ticket_product_variant: { id: "tpv_1" } },
  ...overrides,
})

function cartContainer(items: unknown[] | null) {
  const graph = jest.fn(async () => ({ data: items === null ? [] : [{ id: "cart_1", items }] }))
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected resolve(${key})`)
  })
  return { container: { resolve }, resolve, graph }
}

describe("unseatedTicketLineReason", () => {
  it("passes one seat: a ticket variant, its venue row, seat number and show date, quantity 1", () => {
    expect(unseatedTicketLineReason(seat())).toBeNull()
  })

  it.each<[string, Record<string, unknown>, string]>([
    ["a line with no variant (a custom line)", { variant: null }, "is not a ticket"],
    ["a variant that is not a ticket variant (a plain product)", { variant: { ticket_product_variant: null } }, "is not a ticket"],
    ["a ticket variant read without its id", { variant: { ticket_product_variant: {} } }, "is not a ticket"],
    ["no seat at all, only the show date", { metadata: { show_date: "2027-03-14" } }, "names no venue_row_id, seat_number"],
    ["no venue row", { metadata: { seat_number: "7", show_date: "2027-03-14" } }, "names no venue_row_id"],
    ["no seat number", { metadata: { venue_row_id: "row_1", show_date: "2027-03-14" } }, "names no seat_number"],
    ["no show date", { metadata: { venue_row_id: "row_1", seat_number: "7" } }, "names no show_date"],
    ["an empty seat number", { metadata: { venue_row_id: "row_1", seat_number: "", show_date: "2027-03-14" } }, "names no seat_number"],
    ["no metadata", { metadata: null }, "names no venue_row_id, seat_number, show_date"],
    ["two of one seat", { quantity: 2 }, "asks for 2 of one seat"],
    ["none of one seat", { quantity: 0 }, "asks for 0 of one seat"],
  ])("refuses %s", (_label, overrides, reason) => {
    expect(unseatedTicketLineReason(seat(overrides))).toBe(reason)
  })

  it("names every line that is not one seat, by id, and passes over the seats", () => {
    expect(
      unseatedTicketLines([
        seat(),
        seat({ id: "li_poster", variant: { ticket_product_variant: null } }),
        seat({ id: "li_seatless", metadata: { show_date: "2027-03-14" } }),
        null,
      ])
    ).toEqual([
      { id: "li_poster", reason: "is not a ticket" },
      { id: "li_seatless", reason: "names no venue_row_id, seat_number" },
      { id: "#4", reason: "is not a ticket" },
    ])
  })
})

describe("requireSeatedTicketCartStep", () => {
  afterEach(() => {
    delete process.env[TICKETS]
    delete process.env[DIGITAL]
    delete process.env[SUBS]
  })

  it("is its own step, with nothing to undo", () => {
    expect(step.stepName).toBe("require-seated-ticket-cart")
    expect(step.compensateFn).toBeUndefined()
  })

  it.each([
    ["every flag off", {}],
    ["the digital and subscription settlement flags on", { [DIGITAL]: "true", [SUBS]: "true" }],
  ])("its flag off, %s: returns before any read, refusing nothing", async (_label, env: Record<string, string>) => {
    Object.assign(process.env, env)
    const { container, resolve } = cartContainer([seat({ variant: null, quantity: 3, metadata: {} })])
    const res = await step.invokeFn({ cart_id: "cart_1" }, { container })
    expect(res.output).toEqual({ checked: false })
    expect(resolve).not.toHaveBeenCalled()
  })

  describe("its flag on", () => {
    beforeEach(() => {
      process.env[TICKETS] = "true"
    })

    it("reads the cart's lines, their quantity, metadata and ticket variant, and passes a cart of seats", async () => {
      const { container, graph } = cartContainer([seat(), seat({ id: "li_seat_2", metadata: { venue_row_id: "row_1", seat_number: "8", show_date: "2027-03-14" } })])
      const res = await step.invokeFn({ cart_id: "cart_1" }, { container })
      expect(res.output).toEqual({ checked: true })
      expect(graph).toHaveBeenCalledWith({
        entity: "cart",
        fields: ["id", "items.id", "items.quantity", "items.metadata", "items.variant.ticket_product_variant.id"],
        filters: { id: "cart_1" },
      })
    })

    it("refuses a cart holding a seat-less ticket line and a plain product, naming both, as not allowed (400 on the store route)", async () => {
      const { container } = cartContainer([
        seat(),
        seat({ id: "li_seatless", metadata: { show_date: "2027-03-14" } }),
        seat({ id: "li_poster", variant: { ticket_product_variant: null } }),
      ])
      await expect(step.invokeFn({ cart_id: "cart_1" }, { container })).rejects.toMatchObject({
        type: MedusaError.Types.NOT_ALLOWED,
        message:
          "A ticket checkout sells one seat per line and nothing else, and this cart cannot be settled: " +
          "line li_seatless names no venue_row_id, seat_number; line li_poster is not a ticket.",
      })
    })

    it("refuses two of one seat on one line", async () => {
      const { container } = cartContainer([seat({ quantity: 2 })])
      await expect(step.invokeFn({ cart_id: "cart_1" }, { container })).rejects.toThrow(
        "this cart cannot be settled: line li_seat asks for 2 of one seat."
      )
    })

    it("leaves a cart with no lines, or none found, to the seller check and Medusa's completion, which refuse it", async () => {
      for (const items of [[], null]) {
        const { container } = cartContainer(items)
        await expect(step.invokeFn({ cart_id: "cart_1" }, { container })).resolves.toMatchObject({ output: { checked: true } })
      }
    })
  })
})
