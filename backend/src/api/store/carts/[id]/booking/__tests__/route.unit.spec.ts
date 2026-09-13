import { POST } from "../route"
import { BOOKING_MODULE } from "../../../../../../modules/booking"
import { BookingStatus } from "../../../../../../modules/booking/models/booking"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * D9-6: the hop that lets a booking reach its order.
 *
 * The validation cases carry the weight. `booking_id` is caller-supplied, and
 * writing it through unchecked would let anyone stamp someone else's booking
 * onto their own cart and have the subscriber confirm it on payment.
 */
const createRes = () => {
  const res: any = {
    statusCode: 200,
    body: {},
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload ?? {}
      return res
    },
  }
  return res
}

const makeReq = (opts: {
  cart?: Record<string, unknown> | null
  booking?: Record<string, unknown> | null
  body?: Record<string, unknown>
  updateCarts?: jest.Mock
}) => ({
  params: { id: "cart_1" },
  body: opts.body ?? { booking_id: "bk_1" },
  scope: {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) {
        return {
          graph: async () => ({ data: opts.cart === null ? [] : [opts.cart ?? { id: "cart_1", metadata: {} }] }),
        }
      }
      if (key === BOOKING_MODULE) {
        return {
          listBookings: jest.fn(async () =>
            opts.booking === null ? [] : [opts.booking ?? { id: "bk_1", status: BookingStatus.PENDING }]
          ),
        }
      }
      if (key === Modules.CART) {
        return { updateCarts: opts.updateCarts ?? jest.fn(async () => ({})) }
      }
      throw new Error(`unresolvable: ${key}`)
    },
  },
})

describe("POST /store/carts/:id/booking", () => {
  it("stamps a valid booking onto cart metadata", async () => {
    const updateCarts = jest.fn(async () => ({}))
    const res = createRes()
    await POST(makeReq({ updateCarts }) as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(updateCarts).toHaveBeenCalledWith("cart_1", {
      metadata: { booking_id: "bk_1" },
    })
  })

  it("preserves metadata already on the cart", async () => {
    // The affiliate stamp lands on the same object; clobbering it here would
    // silently undo attribution.
    const updateCarts = jest.fn(async () => ({}))
    const res = createRes()
    await POST(
      makeReq({
        cart: { id: "cart_1", metadata: { fbm_short_code: "abc" } },
        updateCarts,
      }) as never,
      res as never
    )

    expect(updateCarts).toHaveBeenCalledWith("cart_1", {
      metadata: { fbm_short_code: "abc", booking_id: "bk_1" },
    })
  })

  it("requires a booking_id", async () => {
    const res = createRes()
    await POST(makeReq({ body: {} }) as never, res as never)
    expect(res.statusCode).toBe(400)
  })

  it("refuses an unknown booking rather than writing it through", async () => {
    const updateCarts = jest.fn(async () => ({}))
    const res = createRes()
    await POST(makeReq({ booking: null, updateCarts }) as never, res as never)

    expect(res.statusCode).toBe(404)
    expect(updateCarts).not.toHaveBeenCalled()
  })

  it("refuses a cancelled booking", async () => {
    const res = createRes()
    await POST(
      makeReq({ booking: { id: "bk_1", status: BookingStatus.CANCELLED } }) as never,
      res as never
    )
    expect(res.statusCode).toBe(409)
  })

  it("refuses a booking that already belongs to an order", async () => {
    // It has been paid for once. Attaching it to a second cart would have the
    // subscriber re-confirm and re-email on someone else's payment.
    const updateCarts = jest.fn(async () => ({}))
    const res = createRes()
    await POST(
      makeReq({
        booking: { id: "bk_1", status: BookingStatus.PENDING, order_id: "order_9" },
        updateCarts,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(409)
    expect(updateCarts).not.toHaveBeenCalled()
  })

  it("404s an unknown cart", async () => {
    const res = createRes()
    await POST(makeReq({ cart: null }) as never, res as never)
    expect(res.statusCode).toBe(404)
  })

  it("is idempotent — the cart loader calls it on every fetch", async () => {
    const updateCarts = jest.fn(async () => ({}))
    const res = createRes()
    await POST(
      makeReq({
        cart: { id: "cart_1", metadata: { booking_id: "bk_1" } },
        updateCarts,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.idempotent).toBe(true)
    expect(updateCarts).not.toHaveBeenCalled()
  })
})
