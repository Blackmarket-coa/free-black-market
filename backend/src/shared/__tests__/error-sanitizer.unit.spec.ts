/**
 * Mock the framework's core error handler with a fake that simply writes a
 * caller-provided status + body. This isolates the sanitizer's only real
 * behaviour: rewriting 5xx response bodies in production. Sentry is mocked so
 * the test never touches telemetry or noisy fallback logging.
 */
jest.mock("@medusajs/framework/http", () => ({
  errorHandler: () => (err: any, _req: any, res: any) => {
    res.status(err.status).json(err.body)
  },
}))
jest.mock("../sentry", () => ({
  captureException: jest.fn(),
}))

function makeReq(overrides: Record<string, unknown> = {}): any {
  return { method: "POST", path: "/store/checkout", ...overrides }
}

function makeRes(): any {
  const res: any = { statusCode: 200 }
  res.status = jest.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = jest.fn((body: unknown) => {
    res.body = body
    return res
  })
  return res
}

// Factory reads NODE_ENV at call time, so set it before requiring the module.
function loadHandler(nodeEnv: string) {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv
  jest.resetModules()
  const { sanitizedErrorHandler } = require("../error-sanitizer")
  const handler = sanitizedErrorHandler()
  process.env.NODE_ENV = prev
  return handler
}

const DB_LEAK =
  'insert into "user" ... duplicate key value violates unique constraint "users_email_unique"'

describe("error-sanitizer", () => {
  it("replaces 5xx error bodies with a generic message in production", () => {
    const handler = loadHandler("production")
    const res = makeRes()
    handler(
      { status: 500, body: { code: "api_error", type: "database_error", message: DB_LEAK } },
      makeReq(),
      res,
      jest.fn(),
    )

    expect(res.statusCode).toBe(500)
    expect(res.body.message).toBe("An internal server error occurred.")
    expect(JSON.stringify(res.body)).not.toContain("users_email_unique")
    // Canonical code/type are preserved so clients can branch on them.
    expect(res.body.code).toBe("api_error")
    expect(res.body.type).toBe("database_error")
  })

  it("passes 4xx client errors through unchanged in production", () => {
    const handler = loadHandler("production")
    const res = makeRes()
    handler(
      { status: 400, body: { type: "invalid_data", message: "email must be a string" } },
      makeReq(),
      res,
      jest.fn(),
    )

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toBe("email must be a string")
  })

  it("leaves 5xx bodies verbose outside production", () => {
    const handler = loadHandler("development")
    const res = makeRes()
    handler(
      { status: 500, body: { code: "api_error", type: "database_error", message: DB_LEAK } },
      makeReq(),
      res,
      jest.fn(),
    )

    expect(res.statusCode).toBe(500)
    expect(res.body.message).toBe(DB_LEAK)
  })
})
