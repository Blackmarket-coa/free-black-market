import { createRateLimiter } from "../rate-limiter"

/**
 * A per-request `max` is what turns a rate limit into a billable meter. These
 * cover the resolver contract only — the plan lookup itself is covered by the
 * seller-plan specs.
 */

type FakeRes = {
  headers: Record<string, string>
  statusCode: number | null
  body: unknown
  set: (k: string, v: string) => void
  status: (c: number) => FakeRes
  json: (b: unknown) => FakeRes
}

const createRes = (): FakeRes => {
  const res: FakeRes = {
    headers: {},
    statusCode: null,
    body: undefined,
    set: (k, v) => {
      res.headers[k] = v
    },
    status: (c) => {
      res.statusCode = c
      return res
    },
    json: (b) => {
      res.body = b
      return res
    },
  }
  return res
}

const req = (ip: string) => ({ ip, headers: {} })

/** Drive a limiter n times and report how many calls reached `next()`. */
async function drive(
  limiter: ReturnType<typeof createRateLimiter>,
  ip: string,
  times: number
): Promise<{ passed: number; lastRes: FakeRes }> {
  let passed = 0
  let lastRes = createRes()
  for (let i = 0; i < times; i++) {
    lastRes = createRes()
    await limiter(req(ip) as never, lastRes as never, (() => {
      passed++
    }) as never)
  }
  return { passed, lastRes }
}

describe("createRateLimiter with a resolved max", () => {
  it("applies the resolver's limit, not a constant", async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: async () => 3,
      fallbackMax: 100,
      keyPrefix: `test-resolved-${Math.random()}`,
    })

    const { passed, lastRes } = await drive(limiter, "203.0.113.1", 5)
    expect(passed).toBe(3)
    expect(lastRes.statusCode).toBe(429)
    expect(lastRes.headers["X-RateLimit-Limit"]).toBe("3")
  })

  it("falls back rather than failing the request when the resolver throws", async () => {
    // A rate limiter is the wrong place to turn a plan-lookup blip into a 500.
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: async () => {
        throw new Error("plan service down")
      },
      fallbackMax: 2,
      keyPrefix: `test-throwing-${Math.random()}`,
    })

    const { passed, lastRes } = await drive(limiter, "203.0.113.2", 3)
    expect(passed).toBe(2)
    expect(lastRes.statusCode).toBe(429)
  })

  it("ignores a nonsense resolver result", async () => {
    // NaN/0/negative would otherwise mean "block everything" — a plan bug must
    // not lock a vendor's storefront out entirely.
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: async () => Number.NaN,
      fallbackMax: 2,
      keyPrefix: `test-nan-${Math.random()}`,
    })

    const { passed } = await drive(limiter, "203.0.113.3", 3)
    expect(passed).toBe(2)
  })

  it("still supports a plain numeric limit", async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      keyPrefix: `test-static-${Math.random()}`,
    })

    const { passed, lastRes } = await drive(limiter, "203.0.113.4", 2)
    expect(passed).toBe(1)
    expect(lastRes.headers["X-RateLimit-Limit"]).toBe("1")
  })

  it("resolves per request, so an upgrade takes effect without a restart", async () => {
    let allowed = 1
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: () => allowed,
      fallbackMax: 1,
      keyPrefix: `test-dynamic-${Math.random()}`,
    })

    const first = await drive(limiter, "203.0.113.5", 2)
    expect(first.passed).toBe(1)

    allowed = 5
    const second = await drive(limiter, "203.0.113.5", 2)
    expect(second.passed).toBe(2)
  })
})
