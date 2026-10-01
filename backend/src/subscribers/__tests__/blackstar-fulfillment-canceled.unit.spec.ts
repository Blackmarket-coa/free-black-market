const emitBlackstarEvent = jest.fn(async () => "evt")
jest.mock("../../lib/blackstar-emit", () => ({
  emitBlackstarEvent: (...args: unknown[]) => (emitBlackstarEvent as any)(...args),
}))

import handler, { config } from "../blackstar-fulfillment-canceled"
import { BLACKSTAR_FULFILLMENT_MODULE } from "../../modules/blackstar-fulfillment"

/**
 * `order.fulfillment_canceled` → BlackstarShipment `cancelled`, and
 * `order.cancelled` to Blackstar once the order has no live Blackstar
 * shipment. This is the work the provider's `cancelFulfillment` could not do
 * from the fulfillment module's cradle.
 */

type Row = {
  id: string
  fulfillment_id: string
  external_status: string | null
  metadata?: Record<string, unknown> | null
}

const makeContainer = (rows: Row[], opts: { listThrows?: boolean } = {}) => {
  const listBlackstarShipments = jest.fn(async (filters: Record<string, unknown>) => {
    if (opts.listThrows) throw new Error("db down")
    return filters.order_id === "order_1" ? rows : []
  })
  const updateBlackstarShipments = jest.fn(async (updates: unknown[]) => updates)
  return {
    listBlackstarShipments,
    updateBlackstarShipments,
    container: {
      resolve: (key: string) => {
        if (key === BLACKSTAR_FULFILLMENT_MODULE) {
          return { listBlackstarShipments, updateBlackstarShipments }
        }
        throw new Error(`unexpected resolve ${key}`)
      },
    },
  }
}

const run = (
  ctx: ReturnType<typeof makeContainer>,
  data: Record<string, unknown> = { order_id: "order_1", fulfillment_id: "ful_1" }
) =>
  handler({
    event: { name: "order.fulfillment_canceled", data },
    container: ctx.container,
  } as never)

const saved = process.env.FBM_BLACKSTAR_INTEGRATION
beforeEach(() => {
  process.env.FBM_BLACKSTAR_INTEGRATION = "1"
  emitBlackstarEvent.mockClear()
})
afterAll(() => {
  if (saved === undefined) delete process.env.FBM_BLACKSTAR_INTEGRATION
  else process.env.FBM_BLACKSTAR_INTEGRATION = saved
})

describe("blackstar fulfillment canceled", () => {
  it("listens to order.fulfillment_canceled", () => {
    expect(config.event).toBe("order.fulfillment_canceled")
  })

  it("does nothing unless FBM_BLACKSTAR_INTEGRATION=1", async () => {
    delete process.env.FBM_BLACKSTAR_INTEGRATION
    const ctx = makeContainer([
      { id: "bs_1", fulfillment_id: "ful_1", external_status: "pending" },
    ])
    await run(ctx)
    process.env.FBM_BLACKSTAR_INTEGRATION = "true"
    await run(ctx)
    expect(ctx.listBlackstarShipments).not.toHaveBeenCalled()
    expect(ctx.updateBlackstarShipments).not.toHaveBeenCalled()
    expect(emitBlackstarEvent).not.toHaveBeenCalled()
  })

  it("ignores events without an order or fulfillment id", async () => {
    const ctx = makeContainer([])
    await run(ctx, { order_id: "order_1" })
    await run(ctx, { fulfillment_id: "ful_1" })
    expect(ctx.listBlackstarShipments).not.toHaveBeenCalled()
  })

  it("does nothing for a fulfillment with no Blackstar shipment", async () => {
    const ctx = makeContainer([
      { id: "bs_2", fulfillment_id: "ful_2", external_status: "pending" },
    ])
    await run(ctx)
    expect(ctx.updateBlackstarShipments).not.toHaveBeenCalled()
    expect(emitBlackstarEvent).not.toHaveBeenCalled()
  })

  it("marks the shipment cancelled and emits order.cancelled per the contract", async () => {
    const ctx = makeContainer([
      {
        id: "bs_1",
        fulfillment_id: "ful_1",
        external_status: "claimed",
        metadata: { note: "kept" },
      },
    ])
    await run(ctx)

    expect(ctx.updateBlackstarShipments).toHaveBeenCalledTimes(1)
    const [[update]] = ctx.updateBlackstarShipments.mock.calls[0] as any
    expect(update).toMatchObject({
      id: "bs_1",
      external_status: "cancelled",
      metadata: { note: "kept", cancelled_via: "order.fulfillment_canceled" },
    })
    expect(typeof update.metadata.cancelled_locally_at).toBe("string")

    expect(emitBlackstarEvent).toHaveBeenCalledWith(
      ctx.container,
      "order.cancelled",
      { source_order_ref: "order_1" },
      // Same id as emit-blackstar-order-cancel.ts, so a later whole-order
      // cancel dedupes instead of sending a second event.
      { eventId: "blackstar:order.cancelled:order_1", correlationId: "order_1" }
    )
  })

  it("marks a pending (never-claimed) shipment cancelled too", async () => {
    const ctx = makeContainer([
      { id: "bs_1", fulfillment_id: "ful_1", external_status: "pending" },
    ])
    await run(ctx)
    expect(ctx.updateBlackstarShipments).toHaveBeenCalledTimes(1)
    expect(emitBlackstarEvent).toHaveBeenCalledTimes(1)
  })

  it("does not cancel the order's listing while another Blackstar shipment is live", async () => {
    const ctx = makeContainer([
      { id: "bs_1", fulfillment_id: "ful_1", external_status: "claimed" },
      { id: "bs_2", fulfillment_id: "ful_2", external_status: "in_transit" },
    ])
    await run(ctx)
    expect(ctx.updateBlackstarShipments).toHaveBeenCalledTimes(1)
    expect(emitBlackstarEvent).not.toHaveBeenCalled()
  })

  it("emits once the last live shipment on the order is cancelled", async () => {
    const ctx = makeContainer([
      { id: "bs_1", fulfillment_id: "ful_1", external_status: "claimed" },
      { id: "bs_2", fulfillment_id: "ful_2", external_status: "cancelled" },
    ])
    await run(ctx)
    expect(emitBlackstarEvent).toHaveBeenCalledTimes(1)
  })

  it("leaves a delivered shipment alone and does not emit", async () => {
    const ctx = makeContainer([
      { id: "bs_1", fulfillment_id: "ful_1", external_status: "delivered" },
    ])
    await run(ctx)
    expect(ctx.updateBlackstarShipments).not.toHaveBeenCalled()
    expect(emitBlackstarEvent).not.toHaveBeenCalled()
  })

  it("leaves a disputed shipment alone (terminal) and does not emit", async () => {
    const ctx = makeContainer([
      { id: "bs_1", fulfillment_id: "ful_1", external_status: "disputed" },
    ])
    await run(ctx)
    expect(ctx.updateBlackstarShipments).not.toHaveBeenCalled()
    expect(emitBlackstarEvent).not.toHaveBeenCalled()
  })

  it("fails soft when the shipment lookup throws", async () => {
    const ctx = makeContainer([], { listThrows: true })
    await expect(run(ctx)).resolves.toBeUndefined()
    expect(emitBlackstarEvent).not.toHaveBeenCalled()
  })
})
