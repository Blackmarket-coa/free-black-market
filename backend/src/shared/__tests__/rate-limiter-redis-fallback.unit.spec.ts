/**
 * SEC-5: with REDIS_URL set, a Redis problem must neither switch the limiter
 * off nor make requests wait.
 *
 * Before: RedisStore.increment returned { count: 1 } when Redis was down or a
 * command failed (every request allowed), and node-redis's connect() never
 * settles while the server is unreachable, so the first rate-limited request
 * after a boot without Redis — and every one after it — awaited forever.
 */

type Res = { code: number; set: () => Res; status: (c: number) => Res; json: () => Res }

function fakeRes(): Res {
  const res: Res = {
    code: 200,
    set: () => res,
    status: (c: number) => {
      res.code = c
      return res
    },
    json: () => res,
  }
  return res
}

const req = { ip: "203.0.113.7", socket: {}, path: "/auth/customer/emailpass" }

async function hit(limiter: (req: unknown, res: unknown, next: () => void) => Promise<unknown>) {
  const res = fakeRes()
  let passed = false
  const started = Date.now()
  await limiter(req, res, () => {
    passed = true
  })
  return { status: passed ? 200 : res.code, ms: Date.now() - started }
}

const ORIGINAL_REDIS_URL = process.env.REDIS_URL
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
})

describe("rate limiter when REDIS_URL points at a Redis that is down", () => {
  it("answers immediately and still refuses past the limit", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:1"
    let createRateLimiter!: typeof import("../rate-limiter").createRateLimiter
    jest.isolateModules(() => {
      createRateLimiter = require("../rate-limiter").createRateLimiter
    })
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, keyPrefix: "sec5-down" })

    const results: { status: number; ms: number }[] = []
    for (let i = 0; i < 5; i++) results.push(await hit(limiter as never))

    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 429, 429])
    // The old store awaited a connect() that never settles; this must not wait.
    expect(Math.max(...results.map((r) => r.ms))).toBeLessThan(1000)
  })
})

describe("rate limiter when Redis is connected but commands fail", () => {
  it("counts in memory instead of allowing every request", async () => {
    process.env.REDIS_URL = "redis://redis.invalid:6379"
    let createRateLimiter!: typeof import("../rate-limiter").createRateLimiter
    jest.isolateModules(() => {
      jest.doMock("redis", () => ({
        createClient: () => ({
          isReady: true,
          on: () => undefined,
          connect: () => Promise.resolve(),
          incr: () => Promise.reject(new Error("READONLY You can't write against a read only replica")),
          expire: () => Promise.reject(new Error("unreachable")),
          ttl: () => Promise.reject(new Error("unreachable")),
          get: () => Promise.reject(new Error("unreachable")),
          setEx: () => Promise.reject(new Error("unreachable")),
        }),
      }))
      createRateLimiter = require("../rate-limiter").createRateLimiter
    })
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, keyPrefix: "sec5-errors" })

    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await hit(limiter as never)).status)

    // The old store returned count 1 on every failed INCR: [200, 200, 200, 200].
    expect(statuses).toEqual([200, 200, 429, 429])
  })
})
