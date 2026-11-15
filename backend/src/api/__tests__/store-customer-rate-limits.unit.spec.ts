import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Issue #97: signed-in shoppers clicking through account tabs were shown
 * "We're refreshing your session" — a non-401 failure of
 * GET /store/customers/me.
 *
 * Cause: `src/api/middlewares.ts` put the 20-per-minute, IP-keyed
 * `authRateLimiter` on a `/store/customers` entry with no method. Medusa
 * registers a method-less entry with `app.use` (router.js,
 * `_registerExpressHandler`), and `app.use` prefix-matches, so the login
 * budget also covered every /store/customers/me/** read. The storefront makes
 * those reads server-side, so every shopper arrived from the storefront's own
 * address and all of them shared one bucket.
 *
 * What is real here, as in nested-middleware-auth.unit.spec.ts: Medusa's own
 * MiddlewareFileLoader scanning `src/api`, Medusa's RoutesSorter, entries
 * registered on express the way ApiLoader does it (method-less via
 * `app.use`, the rest per verb), the framework's optional /store customer
 * authenticate in front (router.js), and our rate limiters with the in-memory
 * store. Every request comes from 127.0.0.1, which is exactly the
 * one-address situation the storefront puts the backend in. The route
 * handlers are sentinels.
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
type Verb = "GET" | "POST" | "DELETE"

const API_DIR = path.resolve(__dirname, "..")
const JWT_SECRET = "store-customer-rate-limits-spec-secret"

// The routes under /store/customers that a shopper's browser session reaches:
// Medusa core's (registration, the account, addresses) and FBM's own under
// src/api/store/customers/me.
const ROUTES: [string, Verb][] = [
  ["/store/customers", "POST"],
  ["/store/customers/me", "GET"],
  ["/store/customers/me", "POST"],
  ["/store/customers/me/addresses", "GET"],
  ["/store/customers/me/addresses/:address_id", "DELETE"],
  ["/store/customers/me/data-export", "GET"],
  ["/store/customers/me/deletion", "POST"],
  ["/store/customers/me/entitlements", "GET"],
  ["/store/customers/me/digital-products", "GET"],
  ["/store/customers/me/order-channels", "GET"],
]

function token(actorId: string): string {
  return jwt.sign(
    { actor_id: actorId, actor_type: "customer", auth_identity_id: `authid_${actorId}`, app_metadata: {}, user_metadata: {} },
    JWT_SECRET
  )
}

function scopeFor() {
  return {
    resolve(key: string) {
      if (key === ContainerRegistrationKeys.CONFIG_MODULE) {
        return { projectConfig: { http: { jwtSecret: JWT_SECRET } } }
      }
      throw new Error(`unexpected container key in spec: ${key}`)
    },
  }
}

let server: http.Server
let baseUrl = ""

beforeAll(async () => {
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  const loaded = loader.getMiddlewares().filter((m) => String(m.matcher).startsWith("/store/customers"))

  const sentinels: SentinelRoute[] = ROUTES.map(([matcher, method]) => ({
    isRoute: true as const,
    matcher,
    method,
    handler: (req: Request, res: Response) => {
      const ctx = (req as Request & { auth_context?: { actor_id?: string } }).auth_context
      res.status(200).json({ reached: `${method} ${matcher}`, actor: ctx?.actor_id ?? null })
    },
  }))

  const sorted = new RoutesSorter([...loaded, ...sentinels]).sort()

  const app = express()
  app.use((req, _res, next) => {
    ;(req as unknown as { scope: unknown }).scope = scopeFor()
    next()
  })
  // router.js: `applyAuthMiddleware(routesFinder, "/store", "customer", ["bearer", "session"], { allowUnauthenticated: true })`
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

async function call(method: Verb, url: string, bearer?: string) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : undefined,
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body, limitPrefix: res.headers.get("x-ratelimit-limit") }
}

async function statuses(n: number, method: Verb, url: string, bearer?: string): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((await call(method, url, bearer)).status)
  return out
}

// Each test uses its own actors, because limiter buckets persist for the life
// of this file's in-memory store.

describe("issue #97: account reads are not on the login budget", () => {
  it("lets one shopper make 60 account reads in a minute from the storefront's single address", async () => {
    // The old configuration refused the 21st.
    const shopper = token("cus_tabs")
    const seen = await statuses(60, "GET", "/store/customers/me", shopper)
    expect(seen.filter((s) => s !== 200)).toEqual([])
  })

  it("keeps shoppers' budgets separate: one exhausting theirs does not throttle another", async () => {
    const heavy = token("cus_heavy")
    const seen = await statuses(121, "GET", "/store/customers/me", heavy)
    expect(seen.slice(0, 120).every((s) => s === 200)).toBe(true)
    expect(seen[120]).toBe(429)

    const other = await call("GET", "/store/customers/me", token("cus_other"))
    expect(other.status).toBe(200)
    expect(other.body.actor).toBe("cus_other")
  })

  it("budgets each account endpoint separately, so the layout's /me read does not starve a tab", async () => {
    const shopper = token("cus_paths")
    await statuses(120, "GET", "/store/customers/me", shopper)
    expect((await call("GET", "/store/customers/me", shopper)).status).toBe(429)
    expect((await call("GET", "/store/customers/me/addresses", shopper)).status).toBe(200)
  })
})

describe("registration keeps the auth budget", () => {
  it("refuses the 21st POST /store/customers from one address in a minute", async () => {
    const seen = await statuses(21, "POST", "/store/customers")
    expect(seen.slice(0, 20).every((s) => s === 200)).toBe(true)
    expect(seen[20]).toBe(429)
  })
})

describe("the data-rights endpoints keep a strict budget", () => {
  it.each([
    ["GET", "/store/customers/me/data-export", "cus_export"],
    ["POST", "/store/customers/me/deletion", "cus_delete"],
  ] as const)("%s %s: five per five minutes per shopper", async (method, url, actor) => {
    const seen = await statuses(6, method, url, token(actor))
    expect(seen.slice(0, 5).every((s) => s === 200)).toBe(true)
    expect(seen[5]).toBe(429)
  })
})
