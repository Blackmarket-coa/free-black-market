import { sweepExpiredQuotes } from "../quote-expiry"

const quote = (id: string) => ({
  id,
  seller_id: "sel_1",
  customer_id: "cus_1",
})

const fakeService = (rows: ReturnType<typeof quote>[], failOn?: string) => {
  const expired: string[] = []
  return {
    expired,
    service: {
      findExpirable: jest.fn(async () => rows),
      markExpired: jest.fn(async (id: string) => {
        if (id === failOn) throw new Error("write failed")
        expired.push(id)
      }),
    },
  }
}

describe("quote-expiry sweep", () => {
  it("expires each lapsed quote and announces it", async () => {
    const { service, expired } = fakeService([quote("q1"), quote("q2")])
    const emitted: { quote_id: string }[] = []

    const result = await sweepExpiredQuotes(service as never, async (p) => {
      emitted.push(p)
    })

    expect(result).toEqual({ considered: 2, expired: 2, failed: 0 })
    expect(expired).toEqual(["q1", "q2"])
    expect(emitted.map((e) => e.quote_id)).toEqual(["q1", "q2"])
  })

  it("does nothing when no quote has lapsed", async () => {
    const { service } = fakeService([])
    const result = await sweepExpiredQuotes(service as never, async () => {})
    expect(result).toEqual({ considered: 0, expired: 0, failed: 0 })
    expect(service.markExpired).not.toHaveBeenCalled()
  })

  it("writes the status before announcing it", async () => {
    // The opposite ordering to the dunning sweep, deliberately: a crash after
    // the write costs one notification about a quote that has correctly
    // lapsed, which is cheaper than leaving a stale quote showing as live.
    const { service, expired } = fakeService([quote("q1")])

    const result = await sweepExpiredQuotes(service as never, async () => {
      throw new Error("event bus down")
    })

    expect(expired).toEqual(["q1"])
    expect(result).toEqual({ considered: 1, expired: 0, failed: 1 })
  })

  it("keeps going when one quote fails", async () => {
    const { service, expired } = fakeService(
      [quote("q_bad"), quote("q_good")],
      "q_bad"
    )

    const result = await sweepExpiredQuotes(service as never, async () => {})

    expect(result).toEqual({ considered: 2, expired: 1, failed: 1 })
    expect(expired).toEqual(["q_good"])
  })
})
