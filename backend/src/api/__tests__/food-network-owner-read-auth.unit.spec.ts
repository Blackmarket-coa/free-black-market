import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * The food-network reads that are kept for a record's owner have to know who
 * is asking, whatever kind of account the owner is (SD-106).
 *
 * The framework identifies a *customer* on every /store route and nobody
 * else. The community-write matchers admit a seller or a driver on the write
 * verbs, so one can register a courier, own a producer or plan a batch, and
 * on GET it had no `auth_context` at all: the owner-only reads (a courier's
 * shifts and deliveries, a delivery, a batch, a producer's orders, trades and
 * donations) refused the seller or driver who owned the record. On Postgres a
 * seller registered a courier, created a shift on it and was refused the
 * shift list.
 *
 * What is real here, as in store-delivery-proof-rate-limit.unit.spec.ts:
 * Medusa's MiddlewareFileLoader scanning `src/api`, its RoutesSorter, entries
 * registered on express the way ApiLoader does it, and the framework's
 * optional /store customer authenticate in front. The route handlers are
 * sentinels that report the actor they were reached as; what each real
 * handler does with that actor is covered next to the handler, and
 * `integration-tests/http/store-food-network-write-authz.spec.ts` runs a
 * seller-owned courier through the real stack.
 */

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
const JWT_SECRET = "food-network-owner-read-auth-spec-secret"

/** One GET per owner-scoped read (and the public lists beside them). */
const OWNER_READS = [
  "/store/couriers",
  "/store/couriers/:id",
  "/store/couriers/:id/shifts",
  "/store/food-deliveries",
  "/store/food-deliveries/:id",
  "/store/food-deliveries/:id/track",
  "/store/food-deliveries/:id/subscribe",
  "/store/delivery-batches",
  "/store/delivery-batches/:id",
  "/store/food-producers/:id/orders",
  "/store/food-producers/:id/orders/:orderId",
  "/store/food-trades",
  "/store/food-trades/:id",
  "/store/food-donations",
]
/** A community prefix that is not a food-network owner read. */
const OUTSIDE = "/store/gardens/:id"
const PREFIXES = [
  "/store/couriers",
  "/store/food-deliveries",
  "/store/delivery-batches",
  "/store/food-producers",
  "/store/food-trades",
  "/store/food-donations",
  "/store/gardens",
]

function token(actorId: string, actorType: string, secret = JWT_SECRET): string {
  return jwt.sign(
    { actor_id: actorId, actor_type: actorType, auth_identity_id: `authid_${actorId}`, app_metadata: {}, user_metadata: {} },
    secret
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
// The batch prefix is behind FF_PICK_PACK_V1, read per request.
const savedPickPack = process.env.FF_PICK_PACK_V1

beforeAll(async () => {
  process.env.FF_PICK_PACK_V1 = "true"
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  const loaded = loader
    .getMiddlewares()
    .filter((m) => PREFIXES.some((prefix) => String(m.matcher).startsWith(prefix)))

  const sentinel = (matcher: string, method: string): SentinelRoute => ({
    isRoute: true as const,
    matcher,
    method,
    handler: (req: Request, res: Response) => {
      const ctx = (req as Request & { auth_context?: { actor_id?: string; actor_type?: string } }).auth_context
      res.status(200).json({ reached: `${method} ${matcher}`, actor: ctx?.actor_id ?? null, type: ctx?.actor_type ?? null })
    },
  })
  const sentinels = [
    ...[...OWNER_READS, OUTSIDE].map((matcher) => sentinel(matcher, "GET")),
    sentinel("/store/couriers/:id/shifts", "POST"),
  ]

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
  if (savedPickPack === undefined) delete process.env.FF_PICK_PACK_V1
  else process.env.FF_PICK_PACK_V1 = savedPickPack
})

const urlOf = (matcher: string) => matcher.replace(":id", "rec_1").replace(":orderId", "fo_1")

async function call(method: "GET" | "POST", matcher: string, bearer?: string) {
  const res = await fetch(`${baseUrl}${urlOf(matcher)}`, {
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
  return { status: res.status, actor: body.actor, type: body.type, reached: body.reached }
}

describe("GET on the food-network owner reads", () => {
  it.each(OWNER_READS)("%s is reached as the seller or driver who is asking", async (matcher) => {
    for (const [actorId, actorType] of [
      ["mem_seller_1", "seller"],
      ["drv_driver_1", "driver"],
    ] as const) {
      const answer = await call("GET", matcher, token(actorId, actorType))
      expect([matcher, answer.status, answer.reached, answer.actor, answer.type]).toEqual([
        matcher,
        200,
        `GET ${matcher}`,
        actorId,
        actorType,
      ])
    }
  })

  it.each(OWNER_READS)("%s is still reached as the customer who is asking", async (matcher) => {
    const answer = await call("GET", matcher, token("cus_1", "customer"))
    expect([matcher, answer.status, answer.actor, answer.type]).toEqual([matcher, 200, "cus_1", "customer"])
  })

  it.each(OWNER_READS)("%s stays open to a caller with no account, as nobody", async (matcher) => {
    // Optional, not required: the courier and producer catalogues are public,
    // and the owner-only handlers answer 403 themselves.
    const answer = await call("GET", matcher)
    expect([matcher, answer.status, answer.actor]).toEqual([matcher, 200, null])
  })

  it("identifies nobody from a token it cannot verify or an actor type it does not admit", async () => {
    const forged = await call("GET", "/store/couriers/:id/shifts", token("mem_seller_1", "seller", "not-the-secret"))
    expect([forged.status, forged.actor]).toEqual([200, null])
    // An admin user's token is not an owner of anything on these routes.
    const admin = await call("GET", "/store/couriers/:id/shifts", token("user_1", "user"))
    expect([admin.status, admin.actor]).toEqual([200, null])
  })

  it("is not widened beyond the food-network prefixes", async () => {
    // Elsewhere under /store a seller's token is, as the framework leaves it,
    // no customer and therefore nobody.
    const answer = await call("GET", OUTSIDE, token("mem_seller_1", "seller"))
    expect([answer.status, answer.reached, answer.actor]).toEqual([200, `GET ${OUTSIDE}`, null])
  })

  it("leaves the write verbs requiring an account", async () => {
    expect((await call("POST", "/store/couriers/:id/shifts")).status).toBe(401)
    const seller = await call("POST", "/store/couriers/:id/shifts", token("mem_seller_1", "seller"))
    expect([seller.status, seller.actor]).toEqual([200, "mem_seller_1"])
  })
})
