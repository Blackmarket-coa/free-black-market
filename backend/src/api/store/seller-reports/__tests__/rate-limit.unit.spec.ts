import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"

/**
 * `POST /store/seller-reports` accepts a report from anyone, with no session,
 * and every accepted report is a row in the admin request queue. The cap is
 * what keeps one client from burying the real notices.
 *
 * What is real here, as in `src/api/__tests__/store-customer-rate-limits`:
 * Medusa's own MiddlewareFileLoader reading `src/api/middlewares.ts`, Medusa's
 * RoutesSorter, entries registered on express the way ApiLoader does it, and
 * our limiter with the in-memory store. The route handler is a sentinel.
 */

// The limiter store is chosen when the first limiter is created. Pin the
// in-memory store before anything imports shared/rate-limiter.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL

const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
const { MiddlewareFileLoader } = require(path.join(httpDir, "middleware-file-loader")) as {
  MiddlewareFileLoader: new () => {
    scanDir(dir: string): Promise<void>
    getMiddlewares(): LoadedMiddleware[]
  }
}
const { RoutesSorter } = require(path.join(httpDir, "routes-sorter")) as {
  RoutesSorter: new (routes: SortableEntry[]) => { sort(): SortableEntry[] }
}
const { wrapHandler } = require(path.join(httpDir, "utils", "wrap-handler")) as {
  wrapHandler: (fn: Handler) => Handler
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown
type LoadedMiddleware = { handler: Handler; matcher: string; methods?: string[] }
type SentinelRoute = { isRoute: true; matcher: string; method: string; handler: Handler }
type SortableEntry = LoadedMiddleware | SentinelRoute

const API_DIR = path.resolve(__dirname, "../../..")
const ROUTE = "/store/seller-reports"

let server: http.Server
let baseUrl = ""

beforeAll(async () => {
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  const loaded = loader.getMiddlewares().filter((m) => String(m.matcher) === ROUTE)

  const sentinel: SentinelRoute = {
    isRoute: true,
    matcher: ROUTE,
    method: "POST",
    handler: (_req: Request, res: Response) => {
      res.status(201).json({ reached: true })
    },
  }

  const app = express()
  const verbs = app as unknown as Record<string, (p: string, h: Handler) => void>
  for (const entry of new RoutesSorter([...loaded, sentinel]).sort()) {
    if ("isRoute" in entry) {
      verbs[entry.method.toLowerCase()](entry.matcher, wrapHandler(entry.handler))
    } else if (!entry.methods) {
      app.use(entry.matcher, wrapHandler(entry.handler))
    } else {
      for (const m of entry.methods) verbs[m.toLowerCase()](entry.matcher, wrapHandler(entry.handler))
    }
  }

  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
})

describe("POST /store/seller-reports rate limit", () => {
  it("accepts ten reports an hour from one address and refuses the eleventh", async () => {
    const seen: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${baseUrl}${ROUTE}`, { method: "POST" })
      seen.push(res.status)
    }

    expect(seen.slice(0, 10)).toEqual(Array(10).fill(201))
    expect(seen[10]).toBe(429)
  })
})
