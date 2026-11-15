import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Proof of delivery is where a courier proves the hand-over, and for a PIN
 * delivery the PIN is the proof. The assigned courier is exactly who the PIN
 * guards against, and nothing limited guessing it: a 4-digit PIN was 10,000
 * scripted requests.
 *
 * What is real here, as in store-customer-rate-limits.unit.spec.ts: Medusa's
 * MiddlewareFileLoader scanning `src/api`, its RoutesSorter, entries
 * registered on express the way ApiLoader does it, the framework's optional
 * /store customer authenticate in front, the community-write authenticate,
 * and our limiters on the in-memory store. The route handlers are sentinels;
 * the PIN check itself is covered in community-write-authz.unit.spec.ts.
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
type Verb = "GET" | "POST" | "PUT"

const API_DIR = path.resolve(__dirname, "..")
const JWT_SECRET = "store-delivery-proof-rate-limit-spec-secret"

// The routes under /store/food-deliveries/:id that a courier's app writes to.
const ROUTES: [string, Verb][] = [
  ["/store/food-deliveries/:id/proof", "POST"],
  ["/store/food-deliveries/:id", "POST"],
  ["/store/food-deliveries/:id", "PUT"],
  ["/store/food-deliveries/:id/track", "POST"],
]

function token(actorId: string, actorType = "driver"): string {
  return jwt.sign(
    { actor_id: actorId, actor_type: actorType, auth_identity_id: `authid_${actorId}`, app_metadata: {}, user_metadata: {} },
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
  const loaded = loader.getMiddlewares().filter((m) => String(m.matcher).startsWith("/store/food-deliveries"))

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

// Each test uses its own actors and deliveries, because limiter buckets
// persist for the life of this file's in-memory store.

describe("POST /store/food-deliveries/:id/proof is limited per courier per delivery", () => {
  it("allows a courier 5 attempts on one delivery in the window, then refuses", async () => {
    const courier = token("drv_guess")
    const seen = await statuses(7, "POST", "/store/food-deliveries/fd_guess/proof", courier)
    expect(seen).toEqual([200, 200, 200, 200, 200, 429, 429])
  })

  it("shares the budget with the ?x=/proof twin, which reaches the same handler", async () => {
    const courier = token("drv_twin")
    expect(await statuses(3, "POST", "/store/food-deliveries/fd_twin/proof", courier)).toEqual([200, 200, 200])
    expect(await statuses(3, "POST", "/store/food-deliveries/fd_twin?x=/proof", courier)).toEqual([200, 200, 429])
    expect((await call("POST", "/store/food-deliveries/fd_twin/proof", courier)).status).toBe(429)
  })

  it("budgets each delivery separately, and a stranger cannot spend the courier's budget", async () => {
    const courier = token("drv_route")
    const stranger = token("cus_stranger_proof", "customer")
    // A stranger's requests (refused by the handler with 403 in real life)
    // land in the stranger's own bucket.
    expect(await statuses(6, "POST", "/store/food-deliveries/fd_route/proof", stranger)).toEqual([
      200, 200, 200, 200, 200, 429,
    ])
    expect((await call("POST", "/store/food-deliveries/fd_route/proof", courier)).status).toBe(200)

    await statuses(4, "POST", "/store/food-deliveries/fd_route/proof", courier)
    expect((await call("POST", "/store/food-deliveries/fd_route/proof", courier)).status).toBe(429)
    expect((await call("POST", "/store/food-deliveries/fd_next/proof", courier)).status).toBe(200)
  })

  it("keys the bucket by the courier's actor id, not the shared address", async () => {
    // Every request here comes from 127.0.0.1; two couriers on the same
    // delivery path still have separate budgets, so the key is the actor.
    const first = token("drv_a")
    await statuses(5, "POST", "/store/food-deliveries/fd_shared/proof", first)
    expect((await call("POST", "/store/food-deliveries/fd_shared/proof", first)).status).toBe(429)
    const second = await call("POST", "/store/food-deliveries/fd_shared/proof", token("drv_b"))
    expect(second.status).toBe(200)
    expect(second.body.actor).toBe("drv_b")
  })

  it("leaves status updates and position tracking off the proof budget", async () => {
    const courier = token("drv_status")
    await statuses(5, "POST", "/store/food-deliveries/fd_status/proof", courier)
    expect((await call("POST", "/store/food-deliveries/fd_status/proof", courier)).status).toBe(429)
    expect(await statuses(10, "PUT", "/store/food-deliveries/fd_status", courier)).toEqual(Array(10).fill(200))
    expect(await statuses(10, "POST", "/store/food-deliveries/fd_status/track", courier)).toEqual(Array(10).fill(200))
  })

  it("still requires a signed-in actor", async () => {
    expect((await call("POST", "/store/food-deliveries/fd_anon/proof")).status).toBe(401)
  })
})
