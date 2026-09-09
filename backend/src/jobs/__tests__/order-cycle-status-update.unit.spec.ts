import orderCycleStatusUpdateJob, { config } from "../order-cycle-status-update"
import { ORDER_CYCLE_MODULE } from "../../modules/order-cycle"
import { emitBlackoutEvent } from "../../lib/blackout-emit"

jest.mock("../../lib/blackout-emit", () => ({
  emitBlackoutEvent: jest.fn(async () => "evt_1"),
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
  }>
) => {
  const service = { updateOrderCycleStatuses: jest.fn(onCall) }
  return {
    container: {
      resolve: jest.fn((key: string) =>
        key === ORDER_CYCLE_MODULE ? service : undefined
      ),
    },
    service,
  }
}

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
