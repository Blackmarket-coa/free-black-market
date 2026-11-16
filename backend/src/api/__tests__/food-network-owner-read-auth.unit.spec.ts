import fs from "fs"
import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FOOD_NETWORK_OWNER_READ_PREFIXES } from "../middlewares/food-network-owner-read-auth"

/**
 * The food-network reads that are kept for a record's owner have to know who
 * is asking, whatever kind of account the owner is (SD-110 (ii)).
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
 * `integration-tests/http/store-food-network-owner-reads.spec.ts` runs a
 * seller-owned courier, producer and batch through the real stack.
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

/**
 * Every GET handler under the prefixes, with what identifying a seller or a
 * driver changes on it. The matcher runs on all of them, so each was read for
 * what it does with `auth_context`:
 *
 *  - "public": the handler never reads the actor. Nothing changes.
 *  - "owner": it compares the actor's id with an owner column
 *    (`food_producer.owner_id`, `food_courier.owner_id`,
 *    `food_delivery_batch.owner_id`). Each is stamped from the account that
 *    created the row, of whatever type, so a seller or driver id there is the
 *    owner and is now served what a customer owner already was.
 *  - "owner or recipient": as "owner", and also `food_order.customer_id`.
 *    That column is written by one route, `POST
 *    /store/food-producers/:id/orders`, from `actingCustomerId` (a signed-in
 *    customer's own id, never a body value, never a seller's or driver's id),
 *    so the recipient arm cannot match a seller or a driver.
 *
 * No handler here compares the actor with a garden membership or any other
 * customer-keyed table, and none reads `actor_type`.
 *
 * A GET route added under these prefixes is identified as a seller or driver
 * from its first request. The first case below fails until it is listed here,
 * which is the prompt to read what it compares the actor with.
 */
const AUDITED_GET_HANDLERS: Record<string, "public" | "owner" | "owner or recipient"> = {
  "/store/couriers": "public",
  "/store/couriers/:id": "owner",
  "/store/couriers/:id/shifts": "owner",
  "/store/delivery-batches": "owner",
  "/store/delivery-batches/:id": "owner",
  "/store/food-deliveries": "owner",
  "/store/food-deliveries/:id": "owner or recipient",
  "/store/food-deliveries/:id/subscribe": "owner or recipient",
  "/store/food-deliveries/:id/track": "owner or recipient",
  "/store/food-donations": "owner",
  "/store/food-producers": "public",
  "/store/food-producers/:id": "public",
  "/store/food-producers/:id/orders": "owner",
  "/store/food-producers/:id/orders/:orderId": "owner",
  "/store/food-trades": "owner",
  "/store/food-trades/:id": "owner or recipient",
}
const OWNER_READS = Object.keys(AUDITED_GET_HANDLERS)
const PUBLIC_READS = OWNER_READS.filter((matcher) => AUDITED_GET_HANDLERS[matcher] === "public")

/** A community prefix that is not a food-network owner read. */
const OUTSIDE = "/store/gardens/:id"
const PREFIXES = [...FOOD_NETWORK_OWNER_READ_PREFIXES, "/store/gardens"]

/** The GET routes on disk under one prefix, as the matchers Medusa gives them. */
function getRoutesUnder(prefix: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full)
      } else if (/^route\.[jt]s$/.test(entry.name)) {
        const source = fs.readFileSync(full, "utf8")
        if (/export\s+(?:async\s+function|const)\s+GET\b/.test(source)) {
          const matcher = path
            .relative(API_DIR, dir)
            .split(path.sep)
            .map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"))
            .join("/")
          found.push(`/${matcher}`)
        }
      }
    }
  }
  walk(path.join(API_DIR, ...prefix.split("/").filter(Boolean)))
  return found
}

function token(
  actorId: string,
  actorType: string,
  opts: { secret?: string; expiresIn?: number } = {}
): string {
  return jwt.sign(
    { actor_id: actorId, actor_type: actorType, auth_identity_id: `authid_${actorId}`, app_metadata: {}, user_metadata: {} },
    opts.secret ?? JWT_SECRET,
    opts.expiresIn === undefined ? {} : { expiresIn: opts.expiresIn }
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
    // Stands in for express-session: the signed-in actor a session cookie
    // would have restored, when a case sends one.
    const session = req.headers[SESSION_HEADER]
    if (typeof session === "string") {
      ;(req as unknown as { session: unknown }).session = { auth_context: JSON.parse(session) }
    }
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
const SESSION_HEADER = "x-spec-session"
const sessionOf = (actorId: string, actorType: string) =>
  JSON.stringify({ actor_id: actorId, actor_type: actorType, auth_identity_id: `authid_${actorId}` })

async function call(method: "GET" | "POST", matcher: string, authorization?: string, session?: string) {
  const res = await fetch(`${baseUrl}${urlOf(matcher)}`, {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(session ? { [SESSION_HEADER]: session } : {}),
    },
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
const bearer = (value: string) => `Bearer ${value}`

describe("GET on the food-network owner reads", () => {
  it("covers every GET route under the prefixes, each read for what it does with the actor", () => {
    const onDisk = FOOD_NETWORK_OWNER_READ_PREFIXES.flatMap(getRoutesUnder).sort()
    expect(onDisk).toEqual([...OWNER_READS].sort())
  })

  it.each(OWNER_READS)("%s is reached as the seller or driver who is asking", async (matcher) => {
    for (const [actorId, actorType] of [
      ["mem_seller_1", "seller"],
      ["drv_driver_1", "driver"],
    ] as const) {
      const answer = await call("GET", matcher, bearer(token(actorId, actorType)))
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
    const answer = await call("GET", matcher, bearer(token("cus_1", "customer")))
    expect([matcher, answer.status, answer.actor, answer.type]).toEqual([matcher, 200, "cus_1", "customer"])
  })

  it.each(OWNER_READS)("%s stays open to a caller with no account, as nobody", async (matcher) => {
    // Optional, not required: the courier and producer catalogues are public,
    // and the owner-only handlers answer 403 themselves.
    const answer = await call("GET", matcher)
    expect([matcher, answer.status, answer.actor]).toEqual([matcher, 200, null])
  })

  it.each([
    ["signed with another secret", bearer(token("mem_seller_1", "seller", { secret: "not-the-secret" }))],
    ["that has expired", bearer(token("mem_seller_1", "seller", { expiresIn: -60 }))],
    ["that is not a token at all", bearer("not.a.jwt")],
    ["sent under another scheme", `Basic ${token("mem_seller_1", "seller")}`],
    // An admin user's token is not an owner of anything on these routes.
    ["of an actor type the write verbs do not admit", bearer(token("user_1", "user"))],
  ])("a token %s identifies nobody and refuses nothing", async (_what, authorization) => {
    // A public read stays a 200 whatever is in the header, as it was when
    // only the framework's optional customer authenticate ran; and an owner
    // read is reached as nobody, for its handler to refuse.
    for (const matcher of [...PUBLIC_READS, "/store/couriers/:id/shifts"]) {
      const answer = await call("GET", matcher, authorization)
      expect([matcher, answer.status, answer.actor]).toEqual([matcher, 200, null])
    }
  })

  it("leaves a caller the framework made a customer as that customer", async () => {
    // A seller's session beside a customer's token. The framework takes the
    // token (the session is not a customer's); `authenticate` run again for
    // all three types would take the session first, and the customer reading
    // their own delivery would be answered as the seller.
    const both = await call(
      "GET",
      "/store/food-deliveries/:id",
      bearer(token("cus_1", "customer")),
      sessionOf("mem_seller_1", "seller")
    )
    expect([both.status, both.actor, both.type]).toEqual([200, "cus_1", "customer"])
    // The session alone is the seller, as a token alone is.
    const sessionOnly = await call("GET", "/store/food-deliveries/:id", undefined, sessionOf("mem_seller_1", "seller"))
    expect([sessionOnly.status, sessionOnly.actor, sessionOnly.type]).toEqual([200, "mem_seller_1", "seller"])
  })

  it("is not widened beyond the food-network prefixes", async () => {
    // Elsewhere under /store a seller's token is, as the framework leaves it,
    // no customer and therefore nobody.
    const answer = await call("GET", OUTSIDE, bearer(token("mem_seller_1", "seller")))
    expect([answer.status, answer.reached, answer.actor]).toEqual([200, `GET ${OUTSIDE}`, null])
  })

  it("leaves the write verbs requiring an account", async () => {
    expect((await call("POST", "/store/couriers/:id/shifts")).status).toBe(401)
    const expired = await call(
      "POST",
      "/store/couriers/:id/shifts",
      bearer(token("mem_seller_1", "seller", { expiresIn: -60 }))
    )
    expect(expired.status).toBe(401)
    const seller = await call("POST", "/store/couriers/:id/shifts", bearer(token("mem_seller_1", "seller")))
    expect([seller.status, seller.actor]).toEqual([200, "mem_seller_1"])
  })
})
