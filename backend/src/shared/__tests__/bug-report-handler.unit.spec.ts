// Avoid loading the real Octokit packages (ESM-only) when this file pulls
// in bug-report-handler.ts, which transitively imports them.
jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }))
jest.mock("@octokit/auth-app", () => ({ createAppAuth: jest.fn() }))

const getGitHubServiceMock = jest.fn()
jest.mock("../github-service", () => ({
  getGitHubService: () => getGitHubServiceMock(),
  resetGitHubServiceForTests: jest.fn(),
}))

import {
  bugReportSchema,
  createBugReportConfigHandler,
  createBugReportHandler,
  isFeatureEnabled,
  sanitizeDiagnosticText,
} from "../bug-report-handler"

type MockRes = {
  status: jest.Mock<MockRes, [number]>
  json: jest.Mock<MockRes, [unknown]>
  statusCode?: number
  payload?: unknown
}

function makeRes(): MockRes {
  const res: MockRes = {
    status: jest.fn().mockImplementation((code: number) => {
      res.statusCode = code
      return res
    }),
    json: jest.fn().mockImplementation((payload: unknown) => {
      res.payload = payload
      return res
    }),
  }
  return res
}

function makeReq(body: unknown, extras: Record<string, unknown> = {}): any {
  return { body, ...extras }
}

describe("bug-report schema", () => {
  it("rejects too-short summary", () => {
    const result = bugReportSchema.safeParse({ summary: "no", description: "this is plenty long" })
    expect(result.success).toBe(false)
  })

  it("rejects too-short description", () => {
    const result = bugReportSchema.safeParse({ summary: "good enough summary", description: "tiny" })
    expect(result.success).toBe(false)
  })

  it("accepts a minimal valid payload", () => {
    const result = bugReportSchema.safeParse({
      summary: "Cart total wrong",
      description: "Adding two items gives wrong total",
    })
    expect(result.success).toBe(true)
  })

  it("accepts diagnostics block when opted-in", () => {
    const result = bugReportSchema.safeParse({
      summary: "Cart total wrong",
      description: "Adding two items gives wrong total",
      includeDiagnostics: true,
      diagnostics: {
        userAgent: "Mozilla/5.0",
        appVersion: "1.2.3",
        pathname: "/cart",
        consoleTail: "info: hello",
      },
    })
    expect(result.success).toBe(true)
  })
})

describe("sanitizeDiagnosticText", () => {
  it("scrubs Authorization: Bearer tokens", () => {
    // Concatenated so secret scanners don't flag the literal as a Bearer token.
    const fakeToken = "abc123" + ".def456." + "ghi789"
    const input = `Authorization: ` + `Bearer ${fakeToken}`
    expect(sanitizeDiagnosticText(input)).toContain("[redacted]")
    expect(sanitizeDiagnosticText(input)).not.toContain(fakeToken)
  })

  it("scrubs access_token kv pairs", () => {
    // String concatenated to avoid tripping secret scanners on the literal.
    const fakeJwtLike = "ey" + "J" + "kid.payload.sig"
    const input = `access_token="${fakeJwtLike}"`
    const out = sanitizeDiagnosticText(input)
    expect(out).toContain("access_token=[redacted]")
  })

  it("scrubs full JWTs anywhere in text", () => {
    const fakeJwt = "ey" + "J" + "abc123.eyJfake.sig123"
    const input = `before ${fakeJwt} after`
    expect(sanitizeDiagnosticText(input)).toContain("[redacted-jwt]")
  })

  it("scrubs cookie headers", () => {
    expect(sanitizeDiagnosticText("Cookie: session=abc123; foo=bar")).toContain("[redacted]")
  })

  it("scrubs email addresses", () => {
    expect(sanitizeDiagnosticText("user is alice@example.com here")).toContain("[redacted-email]")
  })

  it("leaves benign text alone", () => {
    expect(sanitizeDiagnosticText("just a plain log line")).toBe("just a plain log line")
  })
})

describe("isFeatureEnabled", () => {
  const original = process.env.BUG_REPORT_ENABLED
  afterEach(() => {
    if (original === undefined) {
      delete process.env.BUG_REPORT_ENABLED
    } else {
      process.env.BUG_REPORT_ENABLED = original
    }
  })

  it("defaults to enabled when unset", () => {
    delete process.env.BUG_REPORT_ENABLED
    expect(isFeatureEnabled()).toBe(true)
  })

  it("respects 'false'", () => {
    process.env.BUG_REPORT_ENABLED = "false"
    expect(isFeatureEnabled()).toBe(false)
  })

  it("is truthy for anything else", () => {
    process.env.BUG_REPORT_ENABLED = "true"
    expect(isFeatureEnabled()).toBe(true)
    process.env.BUG_REPORT_ENABLED = "yes"
    expect(isFeatureEnabled()).toBe(true)
  })
})

describe("createBugReportHandler", () => {
  const realEnabled = process.env.BUG_REPORT_ENABLED
  const createIssue = jest.fn()
  const uploadScreenshot = jest.fn()

  beforeEach(() => {
    createIssue.mockReset().mockResolvedValue({ url: "https://github.com/o/r/issues/1", number: 1 })
    uploadScreenshot.mockReset().mockResolvedValue({ rawUrl: "https://raw.example/img", path: "p" })
    getGitHubServiceMock.mockReset().mockReturnValue({ createIssue, uploadScreenshot })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (realEnabled === undefined) {
      delete process.env.BUG_REPORT_ENABLED
    } else {
      process.env.BUG_REPORT_ENABLED = realEnabled
    }
  })

  it("returns 404 when feature is disabled", async () => {
    process.env.BUG_REPORT_ENABLED = "false"
    const handler = createBugReportHandler({ source: "storefront" })
    const res = makeRes()
    await handler(makeReq({ summary: "x", description: "y" }), res as any)
    expect(res.statusCode).toBe(404)
  })

  it("returns 400 on invalid payload", async () => {
    const handler = createBugReportHandler({ source: "storefront" })
    const res = makeRes()
    await handler(makeReq({ summary: "", description: "" }), res as any)
    expect(res.statusCode).toBe(400)
    expect(createIssue).not.toHaveBeenCalled()
  })

  it("returns 503 when GitHub service is not configured", async () => {
    getGitHubServiceMock.mockReturnValue(null)
    const handler = createBugReportHandler({ source: "storefront" })
    const res = makeRes()
    await handler(
      makeReq({ summary: "Cart total wrong", description: "Adding two items gives wrong total" }),
      res as any,
    )
    expect(res.statusCode).toBe(503)
  })

  it("creates an issue with source labels", async () => {
    const handler = createBugReportHandler({ source: "vendor-panel" })
    const res = makeRes()
    await handler(
      makeReq({
        summary: "Order export crashes",
        description: "Clicking export blows up the page",
      }),
      res as any,
    )
    expect(createIssue).toHaveBeenCalledTimes(1)
    const call = createIssue.mock.calls[0][0]
    expect(call.title).toBe("Order export crashes")
    expect(call.labels).toEqual(
      expect.arrayContaining(["bug", "user-report", "source:vendor-panel", "vendor-panel"]),
    )
    expect(res.statusCode).toBe(201)
  })

  it("applies extraLabels and extraContext from options", async () => {
    const handler = createBugReportHandler({
      source: "vendor-panel",
      extraLabels: () => ["seller:sel_123"],
      extraContext: () => ({ "Seller ID": "sel_123" }),
    })
    const res = makeRes()
    await handler(
      makeReq({
        summary: "Order export crashes",
        description: "Clicking export blows up the page",
      }),
      res as any,
    )
    const call = createIssue.mock.calls[0][0]
    expect(call.labels).toEqual(expect.arrayContaining(["seller:sel_123"]))
    expect(call.body).toContain("Seller ID")
    expect(call.body).toContain("sel_123")
  })

  it("scrubs tokens from diagnostics before embedding in body", async () => {
    const handler = createBugReportHandler({ source: "storefront" })
    const res = makeRes()
    await handler(
      makeReq({
        summary: "Cart total wrong",
        description: "Adding two items gives wrong total",
        includeDiagnostics: true,
        diagnostics: {
          consoleTail: "auth header: Authorization: " + "Bearer abc.def.ghi",
        },
      }),
      res as any,
    )
    const body: string = createIssue.mock.calls[0][0].body
    expect(body).not.toContain("abc.def.ghi")
    expect(body).toContain("[redacted]")
  })

  it("omits diagnostics section when includeDiagnostics is false", async () => {
    const handler = createBugReportHandler({ source: "storefront" })
    const res = makeRes()
    await handler(
      makeReq({
        summary: "Cart total wrong",
        description: "Adding two items gives wrong total",
        diagnostics: { userAgent: "Mozilla/5.0", appVersion: "1.0" },
      }),
      res as any,
    )
    const body: string = createIssue.mock.calls[0][0].body
    expect(body).not.toContain("Diagnostic info")
    expect(body).not.toContain("Mozilla/5.0")
  })

  it("returns 413 when screenshot exceeds size limit", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 100).toString("base64")
    const handler = createBugReportHandler({ source: "storefront" })
    const res = makeRes()
    await handler(
      makeReq({
        summary: "Cart total wrong",
        description: "Adding two items gives wrong total",
        screenshot: { filename: "x.png", contentBase64: big },
      }),
      res as any,
    )
    expect(res.statusCode).toBe(413)
    expect(createIssue).not.toHaveBeenCalled()
  })

  it("uploads screenshot and references its raw URL in the issue body", async () => {
    const small = Buffer.alloc(128).toString("base64")
    const handler = createBugReportHandler({ source: "storefront" })
    const res = makeRes()
    await handler(
      makeReq({
        summary: "Cart total wrong",
        description: "Adding two items gives wrong total",
        screenshot: { filename: "shot.png", contentBase64: small },
      }),
      res as any,
    )
    expect(uploadScreenshot).toHaveBeenCalledTimes(1)
    const body: string = createIssue.mock.calls[0][0].body
    expect(body).toContain("![screenshot](https://raw.example/img)")
  })

  it("returns 502 if GitHub call throws", async () => {
    createIssue.mockRejectedValueOnce(new Error("rate limited"))
    const handler = createBugReportHandler({ source: "storefront" })
    const res = makeRes()
    await handler(
      makeReq({
        summary: "Cart total wrong",
        description: "Adding two items gives wrong total",
      }),
      res as any,
    )
    expect(res.statusCode).toBe(502)
  })
})

describe("createBugReportConfigHandler", () => {
  beforeEach(() => {
    getGitHubServiceMock.mockReset()
  })

  it("returns enabled: true when service is configured and flag unset", () => {
    getGitHubServiceMock.mockReturnValue({})
    delete process.env.BUG_REPORT_ENABLED
    const handler = createBugReportConfigHandler()
    const res = makeRes()
    handler({} as any, res as any)
    expect(res.payload).toEqual({ enabled: true })
  })

  it("returns enabled: false when feature is disabled", () => {
    getGitHubServiceMock.mockReturnValue({})
    process.env.BUG_REPORT_ENABLED = "false"
    const handler = createBugReportConfigHandler()
    const res = makeRes()
    handler({} as any, res as any)
    expect(res.payload).toEqual({ enabled: false })
    delete process.env.BUG_REPORT_ENABLED
  })

  it("returns enabled: false when service is not configured", () => {
    getGitHubServiceMock.mockReturnValue(null)
    const handler = createBugReportConfigHandler()
    const res = makeRes()
    handler({} as any, res as any)
    expect(res.payload).toEqual({ enabled: false })
  })
})
