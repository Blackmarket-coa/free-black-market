import orderCycleStatusUpdateJob, { config } from "../order-cycle-status-update"
import { ORDER_CYCLE_MODULE } from "../../modules/order-cycle"
import { emitBlackoutEvent } from "../../lib/blackout-emit"

jest.mock("../../lib/blackout-emit", () => ({
  emitBlackoutEvent: jest.fn(async () => "evt_1"),
}))

jest.mock("../../links/order-order-cycle", () => ({
  __esModule: true,
  default: { entryPoint: "order_order_ordercyclemodule_order_cycle" },
}))

const emitMock = emitBlackoutEvent as jest.MockedFunction<typeof emitBlackoutEvent>

/**
 * The scheduled sweep, and the announcement that used to live somewhere it
 * could never run.
 *
 * `PlantShipWindowService.syncCycleStatuses` held the old emit and had zero
 * callers: this job calls the module service directly. So the announcement is
 * here now, wired to the per-cycle callback the sweep gained.
 */
const CYCLE = {
  id: "oc_1",
  name: "Spring Harvest",
  coordinator_seller_id: "sel_coord",
  closes_at: new Date("2026-09-15T00:00:00.000Z"),
}

const makeContainer = (
  onCall: (cb?: (c: Record<string, unknown>, to: "open" | "closed") => Promise<void>) => Promise<{
    opened: number
    closed: number
  }>,
  // Left unresolvable by default, which is what the container looked like
  // before `ordersPlaced` existed: the count then reads as unknown and the
  // field is dropped, so every test written before this one still describes
  // the payload it asserted.
  query?: { graph: jest.Mock }
) => {
  const service = { updateOrderCycleStatuses: jest.fn(onCall) }
  return {
    container: {
      resolve: jest.fn((key: string) => {
        if (key === ORDER_CYCLE_MODULE) return service
        if (key === "query") return query
        return undefined
      }),
    },
    service,
  }
}

const linkRows = (count: number) => ({
  graph: jest.fn().mockResolvedValue({
    data: Array.from({ length: count }, (_, i) => ({ order_id: `o_${i}` })),
  }),
})

beforeEach(() => emitMock.mockClear())

describe("order-cycle-status-update", () => {
  it("announces cycle.open for a cycle that opened", async () => {
    const { container } = makeContainer(async (cb) => {
      await cb?.(CYCLE, "open")
      return { opened: 1, closed: 0 }
    })

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock).toHaveBeenCalledTimes(1)
    const [, type, fields, opts] = emitMock.mock.calls[0]
    expect(type).toBe("cycle.open")
    expect(fields).toEqual({
      vendorId: "sel_coord",
      cycleId: "oc_1",
      name: "Spring Harvest",
      closingAt: "2026-09-15T00:00:00.000Z",
    })
    expect(opts).toEqual({ eventId: "cycle.open:oc_1" })
  })

  it("announces cycle.close for a cycle that closed", async () => {
    const { container } = makeContainer(async (cb) => {
      await cb?.(CYCLE, "closed")
      return { opened: 0, closed: 1 }
    })

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock.mock.calls[0][1]).toBe("cycle.close")
    expect(emitMock.mock.calls[0][3]).toEqual({ eventId: "cycle.close:oc_1" })
  })

  it("puts the order count on cycle.close", async () => {
    const query = linkRows(3)
    const { container } = makeContainer(async (cb) => {
      await cb?.(CYCLE, "closed")
      return { opened: 0, closed: 1 }
    }, query)

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock.mock.calls[0][2]).toEqual({
      vendorId: "sel_coord",
      cycleId: "oc_1",
      name: "Spring Harvest",
      closingAt: "2026-09-15T00:00:00.000Z",
      ordersPlaced: 3,
    })
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { order_cycle_id: "oc_1" } })
    )
  })

  it("does not put an order count on cycle.open", async () => {
    // A cycle that has just opened has had no chance to take orders, so
    // "0 order(s) placed" would read as a result rather than a start.
    // Blackout renders the clause on close only, and so do we.
    const query = linkRows(3)
    const { container } = makeContainer(async (cb) => {
      await cb?.(CYCLE, "open")
      return { opened: 1, closed: 0 }
    }, query)

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock.mock.calls[0][2]).not.toHaveProperty("ordersPlaced")
    expect(query.graph).not.toHaveBeenCalled()
  })

  it("still announces the close when the count cannot be read", async () => {
    // The count is a display field. Losing it must not lose the announcement
    // that the cycle closed at all — and the field is dropped rather than
    // sent as 0, so Blackout says nothing about orders instead of saying
    // there were none.
    const query = {
      graph: jest.fn().mockRejectedValue(new Error("relation does not exist")),
    }
    const { container } = makeContainer(async (cb) => {
      await cb?.(CYCLE, "closed")
      return { opened: 0, closed: 1 }
    }, query)

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(emitMock.mock.calls[0][1]).toBe("cycle.close")
    expect(emitMock.mock.calls[0][2]).not.toHaveProperty("ordersPlaced")
  })

  it("sends a genuine zero as zero", async () => {
    const { container } = makeContainer(async (cb) => {
      await cb?.(CYCLE, "closed")
      return { opened: 0, closed: 1 }
    }, linkRows(0))

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock.mock.calls[0][2]).toMatchObject({ ordersPlaced: 0 })
  })

  it("uses a stable event id, so a retried transition is the same event", async () => {
    // The old emit keyed on Date.now(), which defeats the delivery layer's
    // dedupe: every retry would have been a new event.
    const run = async () => {
      const { container } = makeContainer(async (cb) => {
        await cb?.(CYCLE, "open")
        return { opened: 1, closed: 0 }
      })
      await orderCycleStatusUpdateJob(container as never)
    }

    await run()
    await run()

    expect(emitMock.mock.calls[0][3]).toEqual(emitMock.mock.calls[1][3])
  })

  it("announces once per cycle, not once per sweep", async () => {
    // The old emit sent aggregate counts, which cannot say WHICH cycle moved.
    const { container } = makeContainer(async (cb) => {
      await cb?.({ ...CYCLE, id: "oc_1" }, "open")
      await cb?.({ ...CYCLE, id: "oc_2", name: "Summer" }, "open")
      return { opened: 2, closed: 0 }
    })

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock).toHaveBeenCalledTimes(2)
    expect(emitMock.mock.calls.map((c) => (c[2] as { cycleId: string }).cycleId)).toEqual([
      "oc_1",
      "oc_2",
    ])
  })

  it("skips a row Blackout would reject rather than enqueuing it", async () => {
    const { container } = makeContainer(async (cb) => {
      await cb?.({ ...CYCLE, name: null }, "open")
      return { opened: 1, closed: 0 }
    })

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock).not.toHaveBeenCalled()
  })

  it("emits nothing when no cycle moved", async () => {
    const { container } = makeContainer(async () => ({ opened: 0, closed: 0 }))

    await orderCycleStatusUpdateJob(container as never)

    expect(emitMock).not.toHaveBeenCalled()
  })

  it("still rethrows a sweep failure — this job's own errors are not swallowed", async () => {
    const { container } = makeContainer(async () => {
      throw new Error("database is on fire")
    })

    await expect(orderCycleStatusUpdateJob(container as never)).rejects.toThrow(
      /database is on fire/
    )
  })

  it("keeps its five-minute schedule", async () => {
    expect(config.name).toBe("order-cycle-status-update")
    expect(config.schedule).toBe("*/5 * * * *")
  })
})
