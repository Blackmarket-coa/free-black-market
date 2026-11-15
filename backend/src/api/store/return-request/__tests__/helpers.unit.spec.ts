import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  isSellersReturnOption,
  returnRequestBodySchema,
  toStoreReturnRequest,
  type OrderForReturn,
} from "../helpers"

/**
 * The pure halves of `/store/return-request`. The route itself — auth,
 * ownership, the Medusa return, the seller link, the vendor's view — runs on
 * a real database in `integration-tests/http/store-return-request.spec.ts`;
 * this pins the payload mapping the storefront renders and the body it sends.
 */

describe("toStoreReturnRequest", () => {
  const order = {
    id: "order_1",
    display_id: 42,
    currency_code: "usd",
    items: [{ id: "ordli_1", title: "Tomatoes", unit_price: 5 }],
    seller: { id: "sel_1", name: "Grower", handle: "grower", photo: null },
  }

  it("maps a Medusa return onto the order_return_request shape the storefront reads", () => {
    const req = toStoreReturnRequest(
      {
        id: "return_1",
        order_id: "order_1",
        status: "requested",
        created_at: "2026-11-15T10:00:00.000Z",
        items: [
          {
            item_id: "ordli_1",
            quantity: "2",
            reason_id: "rr_1",
            created_at: "2026-11-15T10:00:01.000Z",
          },
        ],
      },
      order
    )

    expect(req).toEqual({
      id: "return_1",
      status: "requested",
      created_at: "2026-11-15T10:00:00.000Z",
      order: {
        id: "order_1",
        display_id: 42,
        currency_code: "usd",
        items: order.items,
        seller: { id: "sel_1", name: "Grower", handle: "grower", photo: null },
      },
      // `line_item_id` is the ORDER line item: SingleOrderReturn joins on it.
      line_items: [
        {
          line_item_id: "ordli_1",
          quantity: 2,
          reason_id: "rr_1",
          created_at: "2026-11-15T10:00:01.000Z",
        },
      ],
    })
  })

  it("dates a line by its return when the item carries no timestamp, and tolerates a missing seller", () => {
    const req = toStoreReturnRequest(
      {
        id: "return_2",
        order_id: "order_1",
        status: "received",
        created_at: "2026-11-14T00:00:00.000Z",
        items: [{ item_id: "ordli_1", quantity: 1 }],
      },
      { ...order, seller: null }
    )
    expect(req.line_items[0]).toEqual({
      line_item_id: "ordli_1",
      quantity: 1,
      reason_id: null,
      created_at: "2026-11-14T00:00:00.000Z",
    })
    expect(req.order.seller).toBeNull()
  })
})

describe("returnRequestBodySchema", () => {
  // Exactly what OrderReturnSection.handleSubmit sends.
  const body = {
    order_id: "order_1",
    customer_note: "",
    shipping_option_id: "so_1",
    line_items: [{ line_item_id: "ordli_1", quantity: 1, reason_id: "rr_1" }],
  }

  it("accepts the storefront's payload", () => {
    expect(returnRequestBodySchema.safeParse(body).success).toBe(true)
  })

  it("refuses an empty request, a missing return method, a zero quantity and a repeated line", () => {
    expect(returnRequestBodySchema.safeParse({ ...body, line_items: [] }).success).toBe(false)
    expect(returnRequestBodySchema.safeParse({ ...body, shipping_option_id: null }).success).toBe(false)
    expect(
      returnRequestBodySchema.safeParse({
        ...body,
        line_items: [{ line_item_id: "ordli_1", quantity: 0 }],
      }).success
    ).toBe(false)
    expect(
      returnRequestBodySchema.safeParse({
        ...body,
        line_items: [body.line_items[0], body.line_items[0]],
      }).success
    ).toBe(false)
  })
})

describe("isSellersReturnOption", () => {
  const order: OrderForReturn = {
    id: "order_1",
    customer_id: "cus_1",
    seller: { id: "sel_1", shipping_options: [{ id: "so_return" }, { id: "so_outbound" }] },
  }

  const containerWith = (rulesById: Record<string, unknown[]>) => {
    const graph = jest.fn(async ({ filters }: { filters: { id: string } }) => ({
      data: [{ id: filters.id, rules: rulesById[filters.id] ?? [] }],
    }))
    return {
      graph,
      container: {
        resolve: (key: string) => {
          if (key !== ContainerRegistrationKeys.QUERY) throw new Error(`unexpected ${key}`)
          return { graph }
        },
      } as never,
    }
  }

  it("accepts the seller's option that carries the is_return rule", async () => {
    const { container } = containerWith({
      so_return: [{ attribute: "is_return", operator: "eq", value: "true" }],
    })
    await expect(isSellersReturnOption(container, order, "so_return")).resolves.toBe(true)
  })

  it("refuses the seller's outbound option, whatever its other rules say", async () => {
    // Medusa's outbound options carry `enabled_in_store: "true"`: only the
    // `is_return` rule may decide.
    const { container } = containerWith({
      so_outbound: [
        { attribute: "enabled_in_store", operator: "eq", value: "true" },
        { attribute: "is_return", operator: "eq", value: "false" },
      ],
    })
    await expect(isSellersReturnOption(container, order, "so_outbound")).resolves.toBe(false)
  })

  it("refuses another seller's option without reading it", async () => {
    const { container, graph } = containerWith({
      so_elsewhere: [{ attribute: "is_return", operator: "eq", value: "true" }],
    })
    await expect(isSellersReturnOption(container, order, "so_elsewhere")).resolves.toBe(false)
    expect(graph).not.toHaveBeenCalled()
  })
})
