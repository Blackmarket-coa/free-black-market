/**
 * Express-level "wiring" tests for the bug-report routes.
 *
 * Boots a tiny Express app that mounts the same handlers and rate limiters
 * that production registers in src/api/middlewares.ts, then exercises them
 * over real HTTP via Node's http client. Avoids the full Medusa test runner
 * (which currently hits an unrelated migration error on a fresh DB) while
 * still covering: validation, the 503-when-not-configured path, the body
 * shape sent to the GitHub service, and the rate limiter.
 */

jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }))
jest.mock("@octokit/auth-app", () => ({ createAppAuth: jest.fn() }))

const createIssue = jest.fn()
const uploadScreenshot = jest.fn()
const getGitHubServiceMock = jest.fn()
jest.mock("../github-service", () => ({
  getGitHubService: () => getGitHubServiceMock(),
  resetGitHubServiceForTests: jest.fn(),
}))

import express from "express"
import http from "http"
import { AddressInfo } from "net"
import { createBugReportHandler, createBugReportConfigHandler } from "../bug-report-handler"
import { bugReportAnonymousRateLimiter } from "../rate-limiter"

let server: http.Server
let baseUrl: string

beforeAll(async () => {
  const app = express()
  app.use(express.json({ limit: "10mb" }))

  // Mirror the production wiring for /store/bug-report:
  //   matcher: "/store/bug-report" + bugReportAnonymousRateLimiter (5/hr/IP)
  //   handler: createBugReportHandler({ source: "storefront" })
  app.post(
    "/store/bug-report",
    bugReportAnonymousRateLimiter as any,
    createBugReportHandler({ source: "storefront" }) as any,
  )
  app.get("/store/bug-report/config", createBugReportConfigHandler() as any)

  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )
})

beforeEach(() => {
  getGitHubServiceMock.mockReset()
  createIssue.mockReset().mockResolvedValue({
    url: "https://github.com/example/repo/issues/42",
    number: 42,
  })
  uploadScreenshot.mockReset()
})

async function request(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

describe("POST /store/bug-report (Express wiring)", () => {
  it("returns 503 when no GitHub service is configured", async () => {
    getGitHubServiceMock.mockReturnValue(null)
    const res = await request("POST", "/store/bug-report", {
      summary: "Cart total wrong",
      description: "Two items give wrong total at checkout step 2",
    })
    expect(res.status).toBe(503)
    expect(res.body.type).toBe("service_unavailable")
  })

  it("returns 400 on invalid payload", async () => {
    getGitHubServiceMock.mockReturnValue({ createIssue, uploadScreenshot })
    const res = await request("POST", "/store/bug-report", {
      summary: "x",
      description: "y",
    })
    expect(res.status).toBe(400)
    expect(createIssue).not.toHaveBeenCalled()
  })

  it("creates a labeled GitHub issue and returns its URL on success", async () => {
    getGitHubServiceMock.mockReturnValue({ createIssue, uploadScreenshot })
    const res = await request("POST", "/store/bug-report", {
      summary: "Cart total wrong",
      description: "Two items give wrong total at checkout step 2",
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      url: "https://github.com/example/repo/issues/42",
      number: 42,
    })
    expect(createIssue).toHaveBeenCalledTimes(1)
    const call = createIssue.mock.calls[0][0]
    expect(call.title).toBe("Cart total wrong")
    expect(call.labels).toEqual(
      expect.arrayContaining(["bug", "user-report", "source:storefront", "storefront"]),
    )
  })

  it("rate limits anonymous submissions when the per-IP cap is exceeded", async () => {
    // The rate-limit store is process-wide, so earlier tests in this file
    // may have already consumed part of the 5/hour budget for 127.0.0.1.
    // We just need to confirm that 429s appear within a burst of 10 requests.
    getGitHubServiceMock.mockReturnValue({ createIssue, uploadScreenshot })
    const body = {
      summary: "Repeated submission test",
      description: "Submitting many times to trip the limiter",
    }
    const statuses: number[] = []
    for (let i = 0; i < 10; i++) {
      const res = await request("POST", "/store/bug-report", body)
      statuses.push(res.status)
    }
    expect(statuses).toContain(429)
  })
})

describe("GET /store/bug-report/config (Express wiring)", () => {
  it("returns enabled: false when service is not configured", async () => {
    getGitHubServiceMock.mockReturnValue(null)
    const res = await request("GET", "/store/bug-report/config")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: false })
  })

  it("returns enabled: true when service is configured and flag is unset", async () => {
    getGitHubServiceMock.mockReturnValue({ createIssue, uploadScreenshot })
    const res = await request("GET", "/store/bug-report/config")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: true })
  })
})
