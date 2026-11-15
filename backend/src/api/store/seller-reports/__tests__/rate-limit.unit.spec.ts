import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"

/**
 * `POST /store/seller-reports` and `POST /store/product-reports` accept a
 * report from anyone, with no session, and every accepted report is a row in
 * the admin request queue. The cap is what keeps one client from burying the
 * real notices; it is one budget across both routes.
 *
 * What is real here, as in `src/api/__tests__/store-customer-rate-limits`:
 * Medusa's own MiddlewareFileLoader reading `src/api/middlewares.ts`, Medusa's
 * RoutesSorter, entries registered on express the way ApiLoader does it, and
 * our limiter with the in-memory store. The route handlers are sentinels.
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
const ROUTES = ["/store/seller-reports", "/store/product-reports"]

let server: http.Server
let baseUrl = ""

beforeAll(async () => {
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  const loaded = loader.getMiddlewares().filter((m) => ROUTES.includes(String(m.matcher)))

  const sentinels: SentinelRoute[] = ROUTES.map((matcher) => ({
    isRoute: true as const,
    matcher,
    method: "POST",
    handler: (_req: Request, res: Response) => {
      res.status(201).json({ reached: matcher })
    },
  }))

  const app = express()
  const verbs = app as unknown as Record<string, (p: string, h: Handler) => void>
  for (const entry of new RoutesSorter([...loaded, ...sentinels]).sort()) {
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

const post = async (route: string) => (await fetch(`${baseUrl}${route}`, { method: "POST" })).status

describe("store report rate limit", () => {
  it("accepts ten reports an hour from one address, of either kind, and refuses the eleventh of both", async () => {
    const seen: number[] = []
    for (let i = 0; i < 10; i++) seen.push(await post(ROUTES[i % 2]))

    expect(seen).toEqual(Array(10).fill(201))
    expect(await post("/store/seller-reports")).toBe(429)
    expect(await post("/store/product-reports")).toBe(429)
  })
})
