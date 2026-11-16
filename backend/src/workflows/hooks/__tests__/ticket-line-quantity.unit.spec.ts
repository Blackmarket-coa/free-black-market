import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

/**
 * One ticket per seat on the store's three cart-line routes: the validate
 * hooks FBM registers on `createCartWorkflow` (`create-cart-validation.ts`),
 * `addToCartWorkflow` (`add-to-cart-validation.ts`) and
 * `updateLineItemInCartWorkflow` (`update-line-item-validation.ts`), with the
 * rules they share in `ticket-line-rules.ts`.
 *
 * Until 2026-11-16 the add hook refused every line not added at quantity 1,
 * ticket or not, and the update and create routes had no hook at all.
 * Core-flows is mocked so that each file's registration hands its handler
 * here, and each handler is called as Medusa calls it,
 * `({ input, cart }, { container })`. The container resolves only
 * `ContainerRegistrationKeys.QUERY`; any other key throws, so a hook that read
 * the query under another name would fail here rather than pass on nothing.
 * `integration-tests/http/store-cart-line-quantity.spec.ts` runs the same
 * cases through the real routes on Postgres.
 */

jest.mock("@medusajs/medusa/core-flows", () => {
  const handlers: Record<string, unknown> = {}
  const hookable = (name: string) => ({
    hooks: {
      validate: (handler: unknown) => {
        handlers[name] = handler
      },
    },
  })
  return {
    __handlers: handlers,
    addToCartWorkflow: hookable("add"),
    updateLineItemInCartWorkflow: hookable("update"),
    createCartWorkflow: hookable("create"),
  }
})

import "../add-to-cart-validation"
import "../update-line-item-validation"
import "../create-cart-validation"
import { ONE_TICKET_PER_SEAT } from "../ticket-line-rules"

type Handler = (args: Record<string, unknown>, context: { container: { resolve: (key: string) => unknown } }) => Promise<void>
const { __handlers: handlers } = jest.requireMock("@medusajs/medusa/core-flows") as {
  __handlers: { add?: Handler; update?: Handler; create?: Handler }
}

const SHOW_DATE = "2027-03-14"
/** A variant with no ticket linked: query.graph returns it with no `ticket_product_variant` key at all (seen on Postgres). */
const TOMATOES = { id: "variant_tomatoes", product_id: "prod_tomatoes" }
/** A ticket variant, with no seat sold. */
const SHOW = { id: "variant_show", product_id: "prod_show", ticket_product_variant: { id: "tpv_show", purchases: [] as unknown[] } }
const seat = (seat_number: string) => ({ venue_row_id: "row_a", seat_number, show_date: SHOW_DATE })

/** A container whose query knows `variants` and a cart holding `cartItems`. */
function world(cartItems: Array<Record<string, unknown>> = [], variants: Array<{ id: string }> = [TOMATOES, SHOW]) {
  const graph = jest.fn(async ({ entity, filters }: { entity: string; filters: { id: string | string[] } }) => {
    const ids = [filters.id].flat()
    if (entity === "product_variant") return { data: variants.filter((v) => ids.includes(v.id)) }
    if (entity === "cart") return { data: [{ id: "cart_1", items: cartItems }] }
    throw new Error(`unexpected entity ${entity}`)
  })
  const resolve = jest.fn((key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    throw new Error(`unexpected container key ${key}`)
  })
  return { context: { container: { resolve } }, graph }
}

/** Run the add hook on one item, against a cart holding `cartItems`. */
async function add(item: Record<string, unknown>, cartItems: Array<Record<string, unknown>> = [], variants?: Array<{ id: string }>) {
  const { context } = world(cartItems, variants)
  return handlers.add!({ input: { cart_id: "cart_1", items: [item] } }, context)
}

/** Run the create hook on `items`; resolves to the reads it made. */
async function create(items: Array<Record<string, unknown>> | undefined) {
  const { context, graph } = world()
  await handlers.create!({ input: { region_id: "reg_1", items }, cart: { items: [] } }, context)
  return graph.mock.calls.map(([q]) => q)
}

/** Run the update hook on `line` (the cart's only line), with `update`; resolves to the variant reads it made. */
async function update(line: Record<string, unknown>, change: Record<string, unknown>, itemId = line.id as string) {
  const { context, graph } = world()
  await handlers.update!({ input: { cart_id: "cart_1", item_id: itemId, update: change }, cart: { id: "cart_1", items: [line] } }, context)
  return graph.mock.calls.map(([q]) => q)
}

const refused = { type: MedusaError.Types.INVALID_DATA, message: ONE_TICKET_PER_SEAT }
const inCart = (n: string) => ({ type: MedusaError.Types.INVALID_DATA, message: `Seat ${n} is already in your cart for show date ${SHOW_DATE}` })

it("registers one validate handler on each workflow", () => {
  expect(typeof handlers.add).toBe("function")
  expect(typeof handlers.update).toBe("function")
  expect(typeof handlers.create).toBe("function")
})

describe("POST /store/carts/:id/line-items (addToCartWorkflow)", () => {
  it.each([
    ["2", { variant_id: TOMATOES.id, quantity: 2 }],
    ["3 for an order cycle", { variant_id: TOMATOES.id, quantity: 3, metadata: { order_cycle_id: "ordcyc_1" } }],
    ["12", { variant_id: TOMATOES.id, quantity: 12 }],
  ])("adds a line that is not a ticket at %s", async (_label, item) => {
    await expect(add(item)).resolves.toBeUndefined()
  })

  it.each([2, 3, 0.5])("refuses a seat line at %s", async (quantity) => {
    await expect(add({ variant_id: SHOW.id, quantity, metadata: seat("7") })).rejects.toMatchObject(refused)
  })

  it("refuses a ticket variant on a line naming no seat at 2, as it always has", async () => {
    await expect(add({ variant_id: SHOW.id, quantity: 2 })).rejects.toMatchObject(refused)
  })

  it("holds a line naming a seat to one whatever its variant", async () => {
    await expect(add({ variant_id: TOMATOES.id, quantity: 2, metadata: seat("7") })).rejects.toMatchObject(refused)
    await expect(add({ variant_id: "variant_gone", quantity: 2, metadata: seat("7") })).rejects.toMatchObject(refused)
  })

  it("adds a seat at 1, and the seat rules after the quantity still refuse", async () => {
    await expect(add({ variant_id: SHOW.id, quantity: 1, metadata: seat("7") })).resolves.toBeUndefined()
    await expect(add({ variant_id: SHOW.id, quantity: 1, metadata: { seat_number: "8" } })).rejects.toMatchObject({
      message: `Show date is required for seat 8 in product ${SHOW.product_id}`,
    })
    await expect(
      add({ variant_id: SHOW.id, quantity: 1, metadata: seat("7") }, [{ id: "item_1", variant_id: SHOW.id, quantity: 1, metadata: seat("7") }])
    ).rejects.toMatchObject(inCart("7"))
  })

  it("refuses a purchased seat when the dates compare equal, and does not yet see one whose date is a Date (open)", async () => {
    const sold = (show_date: unknown) => [{ ...SHOW, ticket_product_variant: { id: "tpv_show", purchases: [{ seat_number: "7", show_date }] } }]
    await expect(add({ variant_id: SHOW.id, quantity: 1, metadata: seat("7") }, [], sold(SHOW_DATE))).rejects.toMatchObject({
      message: `Seat 7 has already been purchased for show date ${SHOW_DATE}`,
    })
    // query.graph returns a purchase's show_date as a Date (measured on Postgres): the add's === never matches it.
    await expect(add({ variant_id: SHOW.id, quantity: 1, metadata: seat("7") }, [], sold(new Date(SHOW_DATE)))).resolves.toBeUndefined()
  })

  describe("a ticket line Medusa would put into a line already in the cart", () => {
    const seatlessShowLine = { id: "item_show", variant_id: SHOW.id, quantity: 1, metadata: {} }

    it("refuses the seatless show added again, whether its metadata is absent, null or empty on either side", async () => {
      for (const existing of [{}, null]) {
        for (const metadata of [undefined, null, {}]) {
          await expect(add({ variant_id: SHOW.id, quantity: 1, metadata }, [{ ...seatlessShowLine, metadata: existing }])).rejects.toMatchObject(refused)
        }
      }
    })

    it("refuses it when the metadata is equal, and adds it as a new line when it differs", async () => {
      const tagged = { ...seatlessShowLine, metadata: { note: "aisle" } }
      await expect(add({ variant_id: SHOW.id, quantity: 1, metadata: { note: "aisle" } }, [tagged])).rejects.toMatchObject(refused)
      await expect(add({ variant_id: SHOW.id, quantity: 1, metadata: { note: "box" } }, [tagged])).resolves.toBeUndefined()
      await expect(add({ variant_id: SHOW.id, quantity: 1 }, [tagged])).resolves.toBeUndefined()
    })

    it("lets a line that is not a ticket go into its matching line, at any quantity", async () => {
      const tomatoesLine = { id: "item_tomatoes", variant_id: TOMATOES.id, quantity: 2, metadata: {} }
      await expect(add({ variant_id: TOMATOES.id, quantity: 3 }, [tomatoesLine])).resolves.toBeUndefined()
      await expect(add({ variant_id: SHOW.id, quantity: 1 }, [tomatoesLine])).resolves.toBeUndefined()
    })
  })
})

describe("POST /store/carts with items (createCartWorkflow)", () => {
  it("reads nothing for a cart created with no items, as the storefront creates one", async () => {
    await expect(create(undefined)).resolves.toEqual([])
    await expect(create([])).resolves.toEqual([])
  })

  it("creates lines that are not tickets at any quantity, after reading their variants under the query's key", async () => {
    const reads = await create([
      { variant_id: TOMATOES.id, quantity: 2 },
      { variant_id: TOMATOES.id, quantity: 5, metadata: { quote_id: "quote_1" } },
    ])
    expect(reads).toEqual([
      {
        entity: "product_variant",
        fields: ["id", "product_id", "ticket_product_variant.id", "ticket_product_variant.purchases.*"],
        filters: { id: [TOMATOES.id] },
      },
    ])
  })

  it("refuses a seat line, or a ticket variant naming no seat, at 2", async () => {
    await expect(create([{ variant_id: SHOW.id, quantity: 2, metadata: seat("7") }])).rejects.toMatchObject(refused)
    await expect(create([{ variant_id: SHOW.id, quantity: 2 }])).rejects.toMatchObject(refused)
    await expect(create([{ variant_id: TOMATOES.id, quantity: 1 }, { variant_id: SHOW.id, quantity: 3 }])).rejects.toMatchObject(refused)
  })

  it("refuses the same seat twice in one request, and a seat with no show date", async () => {
    await expect(
      create([
        { variant_id: SHOW.id, quantity: 1, metadata: seat("7") },
        { variant_id: SHOW.id, quantity: 1, metadata: seat("7") },
      ])
    ).rejects.toMatchObject(inCart("7"))
    await expect(create([{ variant_id: SHOW.id, quantity: 1, metadata: { seat_number: "8" } }])).rejects.toMatchObject({
      message: `Show date is required for seat 8 in product ${SHOW.product_id}`,
    })
  })

  it("creates two seats, and two seatless ticket lines, one ticket each", async () => {
    await expect(
      create([
        { variant_id: SHOW.id, quantity: 1, metadata: seat("7") },
        { variant_id: SHOW.id, quantity: 1, metadata: seat("8") },
        { variant_id: TOMATOES.id, quantity: 4 },
      ])
    ).resolves.toHaveLength(1)
    // createCartWorkflow makes a line of every item; it puts none into another.
    await expect(create([{ variant_id: SHOW.id, quantity: 1 }, { variant_id: SHOW.id, quantity: 1 }])).resolves.toHaveLength(1)
  })
})

describe("POST /store/carts/:id/line-items/:line_id (updateLineItemInCartWorkflow)", () => {
  const plainLine = { id: "item_plain", variant_id: TOMATOES.id, quantity: 2, metadata: null }
  const seatLine = { id: "item_seat", variant_id: SHOW.id, quantity: 1, metadata: seat("7") }

  it("raises a line that is not a ticket to any quantity, after reading its variant under the query's key", async () => {
    const reads = await update(plainLine, { quantity: 4 })
    expect(reads).toEqual([{ entity: "product_variant", fields: ["id", "ticket_product_variant.id"], filters: { id: TOMATOES.id } }])
    await expect(update({ ...plainLine, metadata: { order_cycle_id: "ordcyc_1" } }, { quantity: 30 })).resolves.toHaveLength(1)
  })

  it.each([2, 10, 1.5])("refuses a seat line raised to %s, on its metadata alone", async (quantity) => {
    await expect(update(seatLine, { quantity })).rejects.toMatchObject(refused)
  })

  it("lets a seat line be set to 1, to 0 (which removes it), or changed without a quantity, reading nothing", async () => {
    for (const change of [{ quantity: 1 }, { quantity: 0 }, { metadata: { note: "aisle" } }]) {
      await expect(update(seatLine, change)).resolves.toEqual([])
    }
  })

  it("lets a ticket line above one be stepped down, when the quantity is all that changes", async () => {
    await expect(update({ ...seatLine, quantity: 3 }, { quantity: 2 })).resolves.toEqual([])
    await expect(update({ ...seatLine, quantity: 3, metadata: null }, { quantity: 2 })).resolves.toEqual([])
    // Changing the metadata as well is judged as any other update.
    await expect(update({ ...seatLine, quantity: 3 }, { quantity: 2, metadata: { note: "aisle" } })).rejects.toMatchObject(refused)
    await expect(update({ ...plainLine, quantity: 5 }, { quantity: 3, metadata: seat("9") })).rejects.toMatchObject(refused)
    // Neither the same quantity nor more is a step down.
    await expect(update({ ...seatLine, quantity: 3 }, { quantity: 3 })).rejects.toMatchObject(refused)
    await expect(update({ ...seatLine, quantity: 3 }, { quantity: 4 })).rejects.toMatchObject(refused)
  })

  it("refuses dropping the seat and raising the line in one request", async () => {
    await expect(update(seatLine, { quantity: 2, metadata: { seat_number: "" } })).rejects.toMatchObject(refused)
    await expect(update(seatLine, { quantity: 2, metadata: null })).rejects.toMatchObject(refused)
  })

  it("refuses raising a ticket variant line that names no seat, whether the seat was dropped earlier or never named", async () => {
    await expect(update({ ...seatLine, metadata: { venue_row_id: "row_a", show_date: SHOW_DATE } }, { quantity: 2 })).rejects.toMatchObject(refused)
    await expect(update({ ...seatLine, metadata: null }, { quantity: 3 })).rejects.toMatchObject(refused)
  })

  it("refuses naming a seat on a line and raising it in one request", async () => {
    await expect(update(plainLine, { quantity: 2, metadata: seat("7") })).rejects.toMatchObject(refused)
  })

  it("leaves a line that is not in the cart to Medusa's own 404", async () => {
    await expect(update(seatLine, { quantity: 2 }, "item_elsewhere")).resolves.toEqual([])
  })
})
