import { processChannelFulfillmentSync } from "../channel-fulfillment-sync"
import { CHANNEL_CONNECTOR_MODULE } from "../../modules/channel-connector/module-key"
import { ChannelApiError } from "../../modules/channel-connector/types"

/**
 * Reporting shipments outward. A report that is silently dropped looks
 * identical, from the marketplace's side, to a shipment that never happened —
 * and that is what earns the vendor an account penalty.
 */

const mockPush = jest.fn()
jest.mock("../../modules/channel-connector/adapters", () => ({
  getChannelAdapter: (id: string) =>
    id === "faire"
      ? {
          id: "faire",
          capabilities: ["push_fulfillment"],
          supports: (c: string) => c === "push_fulfillment",
          pushFulfillment: (...a: unknown[]) => mockPush(...a),
        }
      : id === "nofulfil"
        ? {
            id: "nofulfil",
            capabilities: ["pull_orders"],
            supports: (c: string) => c === "pull_orders",
          }
        : null,
}))

const shipment = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  seller_id: "sel_1",
  channel_id: "faire",
  external_id: `bo_${id}`,
  fulfilled_at: new Date("2026-08-03T09:00:00Z"),
  carrier: "Royal Mail",
  tracking_number: `TRK${id}`,
  ...overrides,
})

const makeContainer = (opts: {
  connections?: Record<string, unknown>[]
  pending?: Record<string, unknown>[]
} = {}) => {
  const markFulfillmentReported = jest.fn(async (_id: string) => undefined)
  const recordFulfillmentError = jest.fn(
    async (_id: string, _m: string) => undefined
  )
  const service = {
    listChannelConnections: async () =>
      opts.connections ?? [
        {
          id: "cc_1",
          seller_id: "sel_1",
          channel_id: "faire",
          api_base_url: "https://faire.test",
          access_token: "tok",
          enabled: true,
        },
      ],
    toCredentials: () => ({
      api_base_url: "https://faire.test",
      access_token: "tok",
    }),
    listUnreportedFulfillments: async () => opts.pending ?? [],
    markFulfillmentReported,
    recordFulfillmentError,
  }
  return {
    container: {
      resolve: (k: string) =>
        k === CHANNEL_CONNECTOR_MODULE ? service : undefined,
    },
    markFulfillmentReported,
    recordFulfillmentError,
  }
}

beforeEach(() => jest.clearAllMocks())

describe("processChannelFulfillmentSync", () => {
  it("reports a pending shipment and stamps it", async () => {
    mockPush.mockResolvedValue(undefined)
    const { container, markFulfillmentReported } = makeContainer({
      pending: [shipment("a")],
    })

    const result = await processChannelFulfillmentSync(container as never)

    expect(result).toMatchObject({ pending: 1, reported: 1, failed: 0 })
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        external_order_id: "bo_a",
        carrier: "Royal Mail",
        tracking_number: "TRKa",
      }),
      expect.anything()
    )
    expect(markFulfillmentReported).toHaveBeenCalledWith("a")
  })

  it("leaves a shipment unstamped when the channel rejects it", async () => {
    // Stamping on failure would drop the report permanently — the row would
    // leave the work list having never reached the channel.
    mockPush.mockRejectedValue(new ChannelApiError("bad order", 422, "faire"))
    const { container, markFulfillmentReported, recordFulfillmentError } =
      makeContainer({ pending: [shipment("a")] })

    const result = await processChannelFulfillmentSync(container as never)

    expect(result).toMatchObject({ reported: 0, failed: 1 })
    expect(markFulfillmentReported).not.toHaveBeenCalled()
    expect(recordFulfillmentError).toHaveBeenCalledWith(
      "a",
      expect.stringContaining("bad order")
    )
  })

  it("keeps going past a rejection but stops on a retryable failure", async () => {
    // A 422 affects one shipment; a 429 will hit every remaining one, so
    // continuing would burn the queue against a wall.
    mockPush
      .mockRejectedValueOnce(new ChannelApiError("bad order", 422, "faire"))
      .mockResolvedValueOnce(undefined)
    const { container, markFulfillmentReported } = makeContainer({
      pending: [shipment("a"), shipment("b")],
    })
    let result = await processChannelFulfillmentSync(container as never)
    expect(result).toMatchObject({ failed: 1, reported: 1 })
    expect(markFulfillmentReported).toHaveBeenCalledWith("b")

    jest.clearAllMocks()
    mockPush.mockRejectedValueOnce(
      new ChannelApiError("slow down", 429, "faire")
    )
    const c2 = makeContainer({ pending: [shipment("a"), shipment("b")] })
    result = await processChannelFulfillmentSync(c2.container as never)
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(c2.markFulfillmentReported).not.toHaveBeenCalled()
  })

  it("skips a channel that does not accept shipment reports", async () => {
    // A declared capability gap, not a failure — the rows simply stay
    // unreported rather than being counted as errors forever.
    const { container } = makeContainer({
      connections: [
        {
          id: "cc_2",
          seller_id: "sel_1",
          channel_id: "nofulfil",
          enabled: true,
        },
      ],
      pending: [shipment("a", { channel_id: "nofulfil" })],
    })

    const result = await processChannelFulfillmentSync(container as never)
    expect(result).toMatchObject({ connections: 0, pending: 0, failed: 0 })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("skips a paused connection", async () => {
    const { container } = makeContainer({
      connections: [
        { id: "cc_1", seller_id: "sel_1", channel_id: "faire", enabled: false },
      ],
      pending: [shipment("a")],
    })
    const result = await processChannelFulfillmentSync(container as never)
    expect(result.connections).toBe(0)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("only reports shipments belonging to the connection's seller", async () => {
    // The pending list is queried per channel, not per seller — two vendors on
    // the same channel must not have their shipments pushed with each other's
    // credentials.
    const { container } = makeContainer({
      pending: [shipment("a"), shipment("b", { seller_id: "sel_OTHER" })],
    })
    mockPush.mockResolvedValue(undefined)

    const result = await processChannelFulfillmentSync(container as never)

    expect(result.pending).toBe(1)
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ external_order_id: "bo_a" }),
      expect.anything()
    )
  })

  it("does nothing when there is nothing pending", async () => {
    const { container } = makeContainer({ pending: [] })
    const result = await processChannelFulfillmentSync(container as never)
    expect(result).toMatchObject({ connections: 0, pending: 0, reported: 0 })
  })
})
