import emitBlackoutAidRequest, { config } from "../emit-blackout-aid-request"
import { MUTUAL_AID_MODULE } from "../../modules/mutual-aid"
import { emitBlackoutEvent } from "../../lib/blackout-emit"
import { AID_REQUEST_CHANGED } from "../../lib/aid-events"

jest.mock("../../lib/blackout-emit", () => ({
  emitBlackoutEvent: jest.fn(async () => "evt_1"),
}))

const emitMock = emitBlackoutEvent as jest.MockedFunction<typeof emitBlackoutEvent>

/**
 * The §3.8 mirror emitter. One subscriber for all three types, because the
 * request's own status decides which one to send — so the routes never have to
 * know the wire vocabulary, and a status nobody has decided a meaning for
 * produces no event rather than a wrong one.
 */
const ROW = {
  id: "mar_1",
  requester_id: "cus_asker",
  title: "Ride to a dialysis appointment",
  description: "Tuesdays and Thursdays",
  category: "transport",
  status: "OPEN",
  urgency: "URGENT",
  latitude: 42.3314,
  longitude: -83.0458,
  locality: "Southwest Detroit",
  created_at: new Date("2026-09-08T11:00:00.000Z"),
}

const makeContainer = (rows: Array<Record<string, unknown>>) => {
  const service = {
    listMutualAidRequests: jest.fn(async (_f: Record<string, unknown>) => rows),
  }
  const container = {
    resolve: jest.fn((key: string) =>
      key === MUTUAL_AID_MODULE ? service : undefined
    ),
  }
  return { container, service }
}

type Args = Parameters<typeof emitBlackoutAidRequest>[0]

const run = async (
  container: unknown,
  data: Record<string, unknown> = { request_id: "mar_1" }
) =>
  emitBlackoutAidRequest({
    event: { name: AID_REQUEST_CHANGED, data },
    container,
  } as unknown as Args)

beforeEach(() => emitMock.mockClear())

describe("emit-blackout-aid-request", () => {
  it("listens to the one internal event the routes and the sweep emit", () => {
    expect(config.event).toBe(AID_REQUEST_CHANGED)
    expect(config.event).toBe("mutual_aid.request_changed")
  })

  it("emits aid.request.opened for a new ask", async () => {
    const { container } = makeContainer([ROW])
    await run(container)

    expect(emitMock).toHaveBeenCalledTimes(1)
    const [, type, fields, opts] = emitMock.mock.calls[0]
    expect(type).toBe("aid.request.opened")
    expect(fields).toMatchObject({
      requestId: "mar_1",
      locality: "Southwest Detroit",
      status: "OPEN",
    })
    expect(opts).toEqual({ eventId: "aid.request.opened:mar_1" })
  })

  it("emits nothing that identifies the person asking", async () => {
    // The seam's whole point. Blackout's board publishes what it receives
    // verbatim, so this assertion is about what strangers can see.
    const { container } = makeContainer([ROW])
    await run(container)

    const serialized = JSON.stringify(emitMock.mock.calls[0][2])
    expect(serialized).not.toContain("cus_asker")
    expect(serialized).not.toContain("42.33")
    expect(serialized).not.toContain("-83.04")
    expect(serialized).not.toContain("URGENT")
  })

  it("derives the type from the row's status, not from the caller", async () => {
    for (const [status, type] of [
      ["MATCHED", "aid.request.opened"],
      ["FULFILLED", "aid.request.fulfilled"],
      ["WITHDRAWN", "aid.request.closed"],
      ["EXPIRED", "aid.request.closed"],
    ]) {
      emitMock.mockClear()
      const { container } = makeContainer([{ ...ROW, status }])
      await run(container)

      expect(emitMock.mock.calls[0][1]).toBe(type)
      expect(emitMock.mock.calls[0][3]).toEqual({ eventId: `${type}:mar_1` })
    }
  })

  it("emits nothing for a status with no agreed meaning", async () => {
    const { container } = makeContainer([{ ...ROW, status: "SOMETHING_NEW" }])
    await run(container)

    expect(emitMock).not.toHaveBeenCalled()
  })

  it("does nothing without a request id", async () => {
    const { container, service } = makeContainer([ROW])
    await run(container, {})

    expect(service.listMutualAidRequests).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it("does nothing when the row is gone", async () => {
    const { container } = makeContainer([])
    await run(container)

    expect(emitMock).not.toHaveBeenCalled()
  })

  it("swallows a failure rather than failing the aid action that triggered it", async () => {
    const container = {
      resolve: () => {
        throw new Error("module not registered")
      },
    }

    await expect(run(container)).resolves.toBeUndefined()
  })

  it("uses a stable event id so a retry is the same event", async () => {
    // The mirror upserts on the request id, and the delivery layer dedupes on
    // this — a retried transition must not post a second copy of the ask.
    const { container } = makeContainer([ROW])
    await run(container)
    await run(container)

    expect(emitMock.mock.calls[0][3]).toEqual(emitMock.mock.calls[1][3])
  })
})
