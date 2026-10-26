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

  // SD-53: a cart completion that yielded no order. The workflow engine hands
  // the route a serialized `unexpected_state` error carrying the code; the core
  // handler would answer 500 (generic in production). It is answered 409 with
  // the code and the buyer's message instead, in every environment, and the
  // core handler never sees it.
  describe.each(["production", "development"])("a refused cart completion, NODE_ENV=%s", (env) => {
    const refused = {
      name: "MedusaError",
      type: "unexpected_state",
      code: "cart_completion_incomplete",
      message: "Your order could not be completed, and no payment was taken. If your card shows a pending authorization, it will be released. Please try again, or contact support if it happens again.",
      reason: "order_unpaid",
      cart_id: "cart_01STALLED",
      detail: "cart cart_01STALLED: order order_01LEFT owes 5 and has no payment",
      // What the mocked core handler would write, were it reached.
      status: 500,
      body: { code: "cart_completion_incomplete", type: "unexpected_state", message: "An internal server error occurred." },
    }

    it("answers 409 cart_completion_incomplete with the buyer's message and the reason, and no ids", () => {
      const handler = loadHandler(env)
      const res = makeRes()
      handler(refused, makeReq(), res, jest.fn())

      expect(res.statusCode).toBe(409)
      expect(res.body).toEqual({
        code: "cart_completion_incomplete",
        type: "cart_completion_incomplete",
        message: refused.message,
        reason: "order_unpaid",
      })
      expect(JSON.stringify(res.body)).not.toContain("cart_01STALLED")
      expect(JSON.stringify(res.body)).not.toContain("order_01LEFT")
    })
  })

  it("answers any other unexpected_state error as the core handler does", () => {
    const handler = loadHandler("production")
    const res = makeRes()
    handler(
      { type: "unexpected_state", status: 500, body: { code: undefined, type: "unexpected_state", message: DB_LEAK } },
      makeReq(),
      res,
      jest.fn(),
    )
    expect(res.statusCode).toBe(500)
    expect(res.body.message).toBe("An internal server error occurred.")
  })
})
