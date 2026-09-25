import { GET } from "../route"

/**
 * Liveness probe.
 *
 * Pinned here: `commit`, which is how a running deploy says what it is. The
 * Dockerfile bakes GIT_SHA into the image from CI; Railway builds without it
 * and supplies RAILWAY_GIT_COMMIT_SHA instead. An empty GIT_SHA (the
 * Dockerfile's default when no build-arg is passed) must fall through to
 * Railway's value rather than masking it.
 */

const makeRes = () => {
  const res = {
    statusCode: 0,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: Record<string, unknown>) {
      res.body = payload
      return res
    },
  }
  return res
}

const call = async () => {
  const res = makeRes()
  await GET({} as never, res as never)
  return res
}

const saved = {
  GIT_SHA: process.env.GIT_SHA,
  RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
}

const restore = (key: keyof typeof saved) => {
  if (saved[key] === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = saved[key]
  }
}

beforeEach(() => {
  delete process.env.GIT_SHA
  delete process.env.RAILWAY_GIT_COMMIT_SHA
})

afterAll(() => {
  restore("GIT_SHA")
  restore("RAILWAY_GIT_COMMIT_SHA")
})

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      status: "ok",
      service: "freeblackmarket-backend",
    })
  })

  it("reports the image's GIT_SHA as the commit", async () => {
    process.env.GIT_SHA = "0123456789abcdef0123456789abcdef01234567"
    process.env.RAILWAY_GIT_COMMIT_SHA = "railway-sha"
    const res = await call()
    expect(res.body?.commit).toBe("0123456789abcdef0123456789abcdef01234567")
  })

  it("falls back to Railway's commit when GIT_SHA is empty", async () => {
    process.env.GIT_SHA = ""
    process.env.RAILWAY_GIT_COMMIT_SHA = "railway-sha"
    const res = await call()
    expect(res.body?.commit).toBe("railway-sha")
  })

  it("says unknown rather than omitting the field", async () => {
    const res = await call()
    expect(res.body?.commit).toBe("unknown")
  })
})
