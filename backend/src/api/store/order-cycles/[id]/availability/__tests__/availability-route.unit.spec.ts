import { POST } from "../route"
import { ORDER_CYCLE_MODULE } from "../../../../../../modules/order-cycle"

/**
 * `POST /store/order-cycles/:id/availability`.
 *
 * This exists to give `checkProductAvailability` a caller. That method already
 * held every rule that matters — cycle open, variant registered on the cycle,
 * product visible, request within `available_quantity - sold_quantity` — and
 * returned a reason and a `maxQuantity` with it. Nothing in the repo called it,
 * so a cycle's stated limits were decorative.
 */
type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

type Opts = {
  result?: { available: boolean; reason?: string; maxQuantity?: number }
  throws?: boolean
}

const makeCtx = (o: Opts = {}) => {
  const checkProductAvailability = jest.fn(
    async (_c: string, _v: string, _q: number) => {
      if (o.throws) throw new Error("Order cycle not found")
      return o.result ?? { available: true }
    }
  )
  return {
    checkProductAvailability,
    scope: {
      resolve: (key: string) =>
        key === ORDER_CYCLE_MODULE ? { checkProductAvailability } : undefined,
    },
  }
}

type Args = Parameters<typeof POST>

const call = async (ctx: ReturnType<typeof makeCtx>, body: unknown, id = "oc_1") => {
  const res = createRes()
  await POST(
    { params: { id }, body, scope: ctx.scope } as unknown as Args[0],
    res as unknown as Args[1]
  )
  return res
}

describe("POST /store/order-cycles/:id/availability", () => {
  it("asks the module's own rule", async () => {
    const ctx = makeCtx()
    const res = await call(ctx, { variant_id: "v_1", quantity: 3 })

    expect(ctx.checkProductAvailability).toHaveBeenCalledWith("oc_1", "v_1", 3)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ available: true, variant_id: "v_1", quantity: 3 })
  })

  it("answers 200 with available:false rather than treating a refusal as a fault", async () => {
    // "You cannot order five of these" is an answer, not an error.
    const ctx = makeCtx({
      result: { available: false, reason: "Only 2 units available", maxQuantity: 2 },
    })
    const res = await call(ctx, { variant_id: "v_1", quantity: 5 })

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      available: false,
      reason: "Only 2 units available",
      max_quantity: 2,
    })
  })

  it("passes the cycle's own wording through rather than inventing one", async () => {
    const ctx = makeCtx({
      result: { available: false, reason: "Order cycle is closed, not accepting orders" },
    })
    const res = await call(ctx, { variant_id: "v_1" })

    expect(res.body).toMatchObject({
      reason: "Order cycle is closed, not accepting orders",
    })
    expect(res.body).not.toHaveProperty("max_quantity")
  })

  it("defaults to one when no quantity is given", async () => {
    const ctx = makeCtx()
    await call(ctx, { variant_id: "v_1" })

    expect(ctx.checkProductAvailability).toHaveBeenCalledWith("oc_1", "v_1", 1)
  })

  it("requires a variant_id", async () => {
    const ctx = makeCtx()
    for (const body of [{}, { variant_id: "" }, { variant_id: 5 }, undefined]) {
      expect((await call(ctx, body)).statusCode).toBe(400)
    }
    expect(ctx.checkProductAvailability).not.toHaveBeenCalled()
  })

  it.each([0, -2, 1.5, "three", null])(
    "400s a quantity of %p rather than silently treating it as one",
    async (quantity) => {
      // A bad quantity is a caller bug; answering as though they asked for one
      // would hide it and could put the wrong number in a cart.
      const ctx = makeCtx()
      const res = await call(ctx, { variant_id: "v_1", quantity })

      expect(res.statusCode).toBe(400)
      expect(ctx.checkProductAvailability).not.toHaveBeenCalled()
    }
  )

  it("404s an unknown cycle", async () => {
    // checkProductAvailability retrieves the cycle first, so it throws rather
    // than answering available:false.
    const ctx = makeCtx({ throws: true })
    const res = await call(ctx, { variant_id: "v_1" })

    expect(res.statusCode).toBe(404)
  })

  it("requires a cycle id in the path", async () => {
    const ctx = makeCtx()
    const res = await call(ctx, { variant_id: "v_1" }, "")

    expect(res.statusCode).toBe(400)
  })
})
