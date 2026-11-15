import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * `POST /store/wholesale-application` is public (publishable key only) and
 * emails `wholesale-application-received` to the address in its body. Before
 * the email templates existed that send was dropped; once it really sends, an
 * unthrottled route is a mail cannon pointed from FBM's sending domain at any
 * address. This proves the limiter is in front of it through the REAL chain,
 * as store-customer-rate-limits.unit.spec.ts does: Medusa's own
 * MiddlewareFileLoader scanning `src/api`, its RoutesSorter, entries
 * registered the way ApiLoader does it, the framework's optional /store
 * customer authenticate in front, and our limiters on the in-memory store.
 * The route handlers are sentinels.
 */

// The limiter store is chosen when the first limiter is created. Pin the
// in-memory store before anything imports shared/rate-limiter.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL

const limiters = require("../../shared/rate-limiter") as typeof import("../../shared/rate-limiter")

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

const API_DIR = path.resolve(__dirname, "..")
const ROUTE = "/store/wholesale-application"

let server: http.Server
let baseUrl = ""
let loaded: LoadedMiddleware[] = []
let reached = 0

beforeAll(async () => {
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  loaded = loader.getMiddlewares().filter((m) => String(m.matcher).startsWith("/store"))

  const sentinel: SentinelRoute = {
    isRoute: true,
    matcher: ROUTE,
    method: "POST",
    handler: (_req: Request, res: Response) => {
      reached++
      res.status(201).json({ status: "received" })
    },
  }
  const sorted = new RoutesSorter([...loaded, sentinel]).sort()

  const app = express()
  app.use((req, _res, next) => {
    ;(req as unknown as { scope: unknown }).scope = {
      resolve(key: string) {
        if (key === ContainerRegistrationKeys.CONFIG_MODULE) {
          return { projectConfig: { http: { jwtSecret: "wholesale-rate-limit-spec" } } }
        }
        throw new Error(`unexpected container key in spec: ${key}`)
      },
    }
    next()
  })
  app.use("/store", authenticate("customer", ["bearer", "session"], { allowUnauthenticated: true }) as unknown as Handler)

  const verbs = app as unknown as Record<string, (p: string, h: Handler) => void>
  for (const entry of sorted) {
    if ("isRoute" in entry) {
      verbs[entry.method.toLowerCase()](entry.matcher, wrapHandler(entry.handler))
    } else if (!entry.methods) {
      app.use(entry.matcher, wrapHandler(entry.handler))
    } else {
      for (const m of entry.methods) verbs[m.toLowerCase()](entry.matcher, wrapHandler(entry.handler))
    }
  }
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ message: err.message })
  })

  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
})

async function post() {
  const res = await fetch(`${baseUrl}${ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "anyone@example.com" }),
  })
  return { status: res.status, limit: res.headers.get("x-ratelimit-limit") }
}

describe("POST /store/wholesale-application is rate limited", () => {
  it("is wired to its own limiter in the middleware Medusa loads", () => {
    const limiter: unknown = limiters.wholesaleApplicationRateLimiter
    expect(typeof limiter).toBe("function")
    const hits = loaded.filter((l) => l.matcher === ROUTE && (l.methods ?? []).includes("POST"))
    expect(hits.map((h) => h.handler)).toContain(limiter)
  })

  it("lets five applications through from one address in an hour and refuses the sixth before the handler runs", async () => {
    const seen: number[] = []
    for (let i = 0; i < 6; i++) seen.push((await post()).status)
    expect(seen.slice(0, 5)).toEqual([201, 201, 201, 201, 201])
    expect(seen[5]).toBe(429)
    // The refused request never reached the route, so no row and no email.
    expect(reached).toBe(5)
  })

  it("advertises the declared budget", async () => {
    expect((await post()).limit).toBe("5")
  })
})
