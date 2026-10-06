import fs from "fs"
import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import { authenticate } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"
import { RESTAURANT_MODULE } from "../../modules/restaurant"
import { DELIVERY_MODULE } from "../../modules/delivery"

/**
 * The nested route sets, through the REAL middleware chain.
 *
 * What is real here: Medusa's own MiddlewareFileLoader scanning `src/api`
 * (so the entries come from `src/api/middlewares.ts` exactly as the server
 * loads them, spreads included), Medusa's own RoutesSorter ordering them
 * together with the routes, the framework's `authenticate()`, our rate
 * limiters, feature-flag middleware and delivery ownership guards. Entries are
 * registered on express the way ApiLoader._registerExpressHandler does it
 * (method-less entries via `app.use`, the rest per verb), and every /store
 * request first passes the framework's own optional customer auth, as
 * router.js does for /store.
 *
 * What is a stand-in: the route HANDLERS. Each route file under the tested
 * surfaces is registered at its real path and for the verbs it really exports,
 * with a sentinel that reports it was reached and with which actor. The
 * handlers' own 401s are covered by their own specs; this file proves the
 * middleware in front of them.
 */

// The limiter store is chosen when the first limiter is created. Pin the
// in-memory store before anything imports shared/rate-limiter.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL

const limiters = require("../../shared/rate-limiter") as typeof import("../../shared/rate-limiter")
const { storeHawalaMiddlewareRoutes } = require("../store/hawala/_middlewares") as typeof import("../store/hawala/_middlewares")
const { storeCollectiveMiddlewareRoutes } = require("../store/collective/_middlewares") as typeof import("../store/collective/_middlewares")
const { mutualAidMiddlewareRoutes } = require("../store/mutual-aid/_middlewares") as typeof import("../store/mutual-aid/_middlewares")
const { vendorHawalaMiddlewareRoutes } = require("../vendor/hawala/_middlewares") as typeof import("../vendor/hawala/_middlewares")
const { vendorWellnessMiddlewareRoutes } = require("../vendor/wellness/_middlewares") as typeof import("../vendor/wellness/_middlewares")
const { deliveryMiddlewareRoutes } = require("../deliveries/[id]/_middlewares") as typeof import("../deliveries/[id]/_middlewares")

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
type Verb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

const API_DIR = path.resolve(__dirname, "..")
const JWT_SECRET = "nested-middleware-auth-spec-secret"
const SURFACES = ["/store/hawala", "/store/collective", "/store/mutual-aid", "/deliveries"]

const FF_POOLS = PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1
const FF_PARITY = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const FF_WALLET = PHASE0_FEATURE_FLAGS.CUSTOMER_WALLET_V1

function token(actorType: string, actorId: string): string {
  return jwt.sign(
    { actor_id: actorId, actor_type: actorType, auth_identity_id: `authid_${actorId}`, app_metadata: {}, user_metadata: {} },
    JWT_SECRET
  )
}

// ---------------------------------------------------------------------------
// Route files on disk -> sentinel routes, the way Medusa's RoutesLoader maps
// `[param]` directories to `:param` segments.
// ---------------------------------------------------------------------------
function exportedVerbs(routeFile: string): Verb[] {
  const src = fs.readFileSync(routeFile, "utf8")
  const verbs = new Set<Verb>()
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
    verbs.add(m[1] as Verb)
  }
  return [...verbs]
}

function routeFilesUnder(prefix: string): { matcher: string; file: string }[] {
  const base = path.join(API_DIR, ...prefix.split("/").filter(Boolean))
  const out: { matcher: string; file: string }[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__") continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.name === "route.ts") {
        const rel = path.relative(API_DIR, dir).split(path.sep)
        const matcher = "/" + rel.map((s) => s.replace(/^\[(.+)\]$/, ":$1")).join("/")
        out.push({ matcher, file: abs })
      }
    }
  }
  walk(base)
  return out
}

/** The route file a middleware matcher points at; `:x` and `*` take the dir's one `[param]` child. */
function routeFileForMatcher(matcher: string): string {
  let dir = API_DIR
  for (const seg of matcher.split("/").filter(Boolean)) {
    if (seg.startsWith(":") || seg === "*") {
      const params = fs.readdirSync(dir).filter((d) => /^\[.+\]$/.test(d))
      if (params.length !== 1) throw new Error(`${matcher}: expected one [param] dir in ${dir}, found ${params}`)
      dir = path.join(dir, params[0])
    } else {
      dir = path.join(dir, seg)
    }
  }
  const file = path.join(dir, "route.ts")
  if (!fs.existsSync(file)) throw new Error(`${matcher}: no route file at ${file}`)
  return file
}

function concretePath(matcher: string): string {
  return matcher
    .split("/")
    .map((s) => (s.startsWith(":") ? `t_${s.slice(1)}` : s === "*" ? "t_star" : s))
    .join("/")
}

// ---------------------------------------------------------------------------
// Container stand-in. The keys are the framework's and the modules' own
// constants, and every resolve is recorded so a test can prove the real guard
// ran rather than a fallback.
// ---------------------------------------------------------------------------
type Delivery = {
  id: string
  transaction_id: string | null
  restaurant?: { id: string } | null
  driver?: { id: string } | null
}
const deliveries: Record<string, Delivery> = {
  dlv_mine: { id: "dlv_mine", transaction_id: "tx_mine", restaurant: { id: "res_1" }, driver: { id: "drv_1" } },
  dlv_theirs: { id: "dlv_theirs", transaction_id: "tx_theirs", restaurant: { id: "res_2" }, driver: { id: "drv_2" } },
  // Mine, but no workflow transaction yet: a subscription would hear them all.
  dlv_notx: { id: "dlv_notx", transaction_id: null, restaurant: { id: "res_1" }, driver: { id: "drv_1" } },
}
const restaurantAdmins: Record<string, { id: string; restaurant: { id: string } }> = {
  radm_1: { id: "radm_1", restaurant: { id: "res_1" } },
}
let resolved: string[] = []

function scopeFor() {
  return {
    resolve(key: string) {
      resolved.push(key)
      if (key === ContainerRegistrationKeys.CONFIG_MODULE) {
        return { projectConfig: { http: { jwtSecret: JWT_SECRET } } }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return {
          graph: async ({ filters }: { filters: { id: string } }) => ({
            data: deliveries[filters.id] ? [deliveries[filters.id]] : [],
          }),
        }
      }
      if (key === RESTAURANT_MODULE) {
        return {
          retrieveRestaurantAdmin: async (id: string) => {
            if (!restaurantAdmins[id]) throw new Error(`RestaurantAdmin with id: ${id} was not found`)
            return restaurantAdmins[id]
          },
        }
      }
      if (key === DELIVERY_MODULE) {
        return {
          retrieveDelivery: async (id: string) => {
            if (!deliveries[id]) throw new Error(`Delivery with id: ${id} was not found`)
            return deliveries[id]
          },
        }
      }
      throw new Error(`unexpected container key in spec: ${key}`)
    },
  }
}

let loaded: LoadedMiddleware[] = []
let server: http.Server
let baseUrl = ""

beforeAll(async () => {
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  loaded = loader.getMiddlewares()

  const sentinels: SentinelRoute[] = SURFACES.flatMap((prefix) =>
    routeFilesUnder(prefix).flatMap(({ matcher, file }) =>
      exportedVerbs(file).map((method) => ({
        isRoute: true as const,
        matcher,
        method,
        handler: (req: Request, res: Response) => {
          const ctx = (req as Request & { auth_context?: { actor_id?: string } }).auth_context
          res.status(200).json({ reached: `${method} ${matcher}`, actor: ctx?.actor_id ?? null })
        },
      }))
    )
  )

  const surfaceMiddlewares = loaded.filter((m) => SURFACES.some((p) => String(m.matcher).startsWith(p)))
  const sorted = new RoutesSorter([...surfaceMiddlewares, ...sentinels]).sort()

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

beforeEach(() => {
  resolved = []
})

afterEach(() => {
  delete process.env[FF_POOLS]
  delete process.env[FF_PARITY]
  delete process.env[FF_WALLET]
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
  return { status: res.status, body }
}

const isAuthenticate = (fn: unknown) => typeof fn === "function" && fn.name === "authenticateMiddleware"
const verbsOf = (r: MiddlewareRoute): Verb[] | undefined => {
  const m = r.methods ?? r.method
  return m === undefined ? undefined : ((Array.isArray(m) ? m : [m]) as Verb[])
}

// ===========================================================================
describe("the root file, as Medusa loads it, carries every nested route set", () => {
  const sets: [string, MiddlewareRoute[]][] = [
    ["store/hawala", storeHawalaMiddlewareRoutes],
    ["store/collective", storeCollectiveMiddlewareRoutes],
    ["store/mutual-aid", mutualAidMiddlewareRoutes],
    ["vendor/hawala", vendorHawalaMiddlewareRoutes],
    ["vendor/wellness", vendorWellnessMiddlewareRoutes],
    ["deliveries/[id]", deliveryMiddlewareRoutes],
  ]

  it.each(sets)("%s: every middleware is registered with its matcher and verbs", (_name, routes) => {
    expect(routes.length).toBeGreaterThan(0)
    for (const r of routes) {
      const want = verbsOf(r)
      for (const mw of r.middlewares ?? []) {
        const hit = loaded.find(
          (l) =>
            l.handler === mw &&
            l.matcher === r.matcher &&
            JSON.stringify(l.methods ?? null) === JSON.stringify(want ?? null)
        )
        expect({ matcher: r.matcher, verbs: want, found: !!hit }).toEqual({ matcher: r.matcher, verbs: want, found: true })
      }
    }
  })
})

// ===========================================================================
describe("newly-live required customer auth (store hawala, collective, mutual-aid)", () => {
  // Written out by hand, independently of the route sets, so dropping an
  // authenticate from a route set fails that route's own tests below rather
  // than silently shrinking a derived list.
  const EXPECTED: [string, Verb][] = [
    ["/store/hawala/wallet", "GET"],
    ["/store/hawala/wallet", "POST"],
    ["/store/hawala/bank-accounts", "GET"],
    ["/store/hawala/bank-accounts", "POST"],
    ["/store/hawala/bank-accounts/link", "POST"],
    ["/store/hawala/transactions", "GET"],
    ["/store/hawala/deposit", "POST"],
    ["/store/hawala/withdraw", "POST"],
    ["/store/collective/demand-pools", "POST"],
    ["/store/collective/demand-pools/:id", "PATCH"],
    ["/store/collective/demand-pools/:id/join", "POST"],
    ["/store/collective/demand-pools/:id/join", "DELETE"],
    ["/store/collective/demand-pools/:id/bounties", "POST"],
    ["/store/collective/demand-pools/:id/bounties/*/milestones", "POST"],
    ["/store/collective/demand-pools/:id/bounties/*/claim", "POST"],
    ["/store/collective/demand-pools/:id/proposals/*/vote", "POST"],
    ["/store/collective/demand-pools/:id/escrow", "POST"],
    ["/store/collective/demand-pools/:id/escrow", "DELETE"],
    ["/store/collective/demand-pools/:id/barter", "POST"],
    ["/store/collective/demand-pools/:id/barter/*/accept", "POST"],
    ["/store/collective/demand-pools/:id/surplus-disposition", "PUT"],
    ["/store/collective/bargaining-groups", "POST"],
    ["/store/collective/bargaining-groups/:id", "PATCH"],
    ["/store/collective/bargaining-groups/:id/join", "POST"],
    ["/store/collective/bargaining-groups/:id/join", "DELETE"],
    ["/store/collective/bargaining-groups/:id/proposals", "POST"],
    ["/store/collective/bargaining-groups/:id/proposals/*/vote", "POST"],
    ["/store/collective/bargaining-groups/:id/threads", "POST"],
    ["/store/collective/buyer-networks", "POST"],
    ["/store/collective/buyer-networks/:id/join", "POST"],
    ["/store/collective/buyer-networks/:id/join", "DELETE"],
    ["/store/mutual-aid/requests", "POST"],
    ["/store/mutual-aid/offers", "POST"],
    ["/store/mutual-aid/requests/*/match", "POST"],
    ["/store/mutual-aid/requests/*/confirm", "POST"],
    ["/store/mutual-aid/requests/*/withdraw", "POST"],
    ["/store/mutual-aid/offers/*/withdraw", "POST"],
    ["/store/mutual-aid/requests/mine", "GET"],
    ["/store/mutual-aid/offers/mine", "GET"],
  ]

  // The same pairs derived from the route sets: each authenticate entry's
  // matcher and verbs (a method-less entry is `app.use`, a prefix match, so it
  // covers every verb its route file exports and the route files beneath it).
  const derived: [string, Verb][] = []
  for (const r of [...storeHawalaMiddlewareRoutes, ...storeCollectiveMiddlewareRoutes, ...mutualAidMiddlewareRoutes]) {
    if (!(r.middlewares ?? []).some(isAuthenticate)) continue
    const matcher = String(r.matcher)
    const file = routeFileForMatcher(matcher)
    for (const v of verbsOf(r) ?? exportedVerbs(file)) derived.push([matcher, v])
    if (!verbsOf(r)) {
      const sub = routeFilesUnder(path.relative(API_DIR, path.dirname(file)).split(path.sep).join("/"))
      for (const x of sub.filter((y) => y.file !== file)) {
        for (const v of exportedVerbs(x.file)) derived.push([x.matcher, v])
      }
    }
  }
  const cases = EXPECTED

  // The five store hawala wallet entries put FF_CUSTOMER_WALLET_V1 in front of
  // the customer check (see the next describe). These cases are about the
  // customer check, so the wallet is on for them; the collective and mutual-aid
  // routes do not read it.
  beforeEach(() => {
    process.env[FF_WALLET] = "true"
  })

  it("the route sets declare exactly the expected pairs, and each points at a real route file exporting that verb", () => {
    const key = (p: [string, Verb]) => `${p[1]} ${p[0]}`
    expect(derived.map(key).sort()).toEqual(EXPECTED.map(key).sort())
    for (const [matcher, verb] of EXPECTED) expect(exportedVerbs(routeFileForMatcher(matcher))).toContain(verb)
  })

  it.each(cases)("%s %s: 401 without a customer, the handler is not reached", async (matcher, verb) => {
    const res = await call(verb, concretePath(matcher))
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ message: "Unauthorized" })
  })

  it.each(cases)("%s %s: a seller token is not a customer — 401", async (matcher, verb) => {
    const res = await call(verb, concretePath(matcher), token("seller", "sel_1"))
    expect(res.status).toBe(401)
  })

  it.each(cases)("%s %s: with a customer bearer the handler is reached as that customer", async (matcher, verb) => {
    const res = await call(verb, concretePath(matcher), token("customer", "cus_auth"))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ reached: expect.stringContaining(verb), actor: "cus_auth" })
  })
})

// ===========================================================================
describe("/store/hawala customer wallet: FF_CUSTOMER_WALLET_V1 first, then customer, then limiters", () => {
  // Written out by hand: every customer-wallet route file and verb under
  // /store/hawala. bank-accounts/link has no entry of its own; it is covered by
  // the method-less (prefix) /bank-accounts entry, and this list proves it.
  const WALLET: [string, Verb][] = [
    ["/store/hawala/wallet", "GET"],
    ["/store/hawala/wallet", "POST"],
    ["/store/hawala/bank-accounts", "GET"],
    ["/store/hawala/bank-accounts", "POST"],
    ["/store/hawala/bank-accounts/link", "POST"],
    ["/store/hawala/transactions", "GET"],
    ["/store/hawala/deposit", "POST"],
    ["/store/hawala/withdraw", "POST"],
  ]
  const DISABLED = {
    status: 404,
    body: { type: "feature_disabled", message: "Feature flag FF_CUSTOMER_WALLET_V1 is disabled" },
  }

  it("each wallet entry is method-less (the sorter's global bucket, ahead of every verb-specific limiter) and puts the flag FIRST", () => {
    const gated = storeHawalaMiddlewareRoutes.filter((r) =>
      (r.middlewares ?? []).some((m) => typeof m === "function" && m.name === "requireFeatureFlag")
    )
    expect(gated.map((r) => String(r.matcher)).sort()).toEqual([
      "/store/hawala/bank-accounts",
      "/store/hawala/deposit",
      "/store/hawala/transactions",
      "/store/hawala/wallet",
      "/store/hawala/withdraw",
    ])
    for (const r of gated) {
      expect({ matcher: r.matcher, verbs: verbsOf(r) ?? null }).toEqual({ matcher: r.matcher, verbs: null })
      const [first, second] = r.middlewares ?? []
      expect((first as { name?: string }).name).toBe("requireFeatureFlag")
      expect(isAuthenticate(second)).toBe(true)
    }
    // Every wallet route is under one of those prefixes and points at a real
    // route file that exports the verb.
    for (const [matcher, verb] of WALLET) {
      expect(gated.some((r) => matcher === r.matcher || matcher.startsWith(`${String(r.matcher)}/`))).toBe(true)
      expect(exportedVerbs(routeFileForMatcher(matcher))).toContain(verb)
    }
    // ...and that is every route file under /store/hawala except the three
    // surfaces that carry their own flags.
    const ungated = routeFilesUnder("/store/hawala")
      .map((r) => r.matcher)
      .filter((m) => !WALLET.some(([w]) => w === m))
      .sort()
    expect(ungated).toEqual(["/store/hawala/investments", "/store/hawala/pools", "/store/hawala/pools/:id/contributions"])
  })

  it.each(WALLET)("%s %s with the flag off: the same 404 feature_disabled anonymous, as a seller and as a customer; the handler is not reached", async (matcher, verb) => {
    const anon = await call(verb, concretePath(matcher))
    const seller = await call(verb, concretePath(matcher), token("seller", "sel_w"))
    const customer = await call(verb, concretePath(matcher), token("customer", "cus_w"))
    expect(anon).toEqual(DISABLED)
    expect(seller).toEqual(anon)
    expect(customer).toEqual(anon)
  })

  it.each(WALLET)("%s %s with the flag off and every OTHER hawala flag on: still 404", async (matcher, verb) => {
    process.env[FF_POOLS] = "true"
    process.env[FF_PARITY] = "true"
    expect(await call(verb, concretePath(matcher), token("customer", "cus_w"))).toEqual(DISABLED)
  })

  it.each(WALLET)("%s %s with the flag on: today's behaviour — 401 anonymous, reached as the customer", async (matcher, verb) => {
    process.env[FF_WALLET] = "true"
    expect(await call(verb, concretePath(matcher))).toEqual({ status: 401, body: { message: "Unauthorized" } })
    const ok = await call(verb, concretePath(matcher), token("customer", "cus_w"))
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ reached: `${verb} ${matcher}`, actor: "cus_w" })
  })

  it("only the literal string \"true\" opens it", async () => {
    for (const v of ["1", "TRUE", "yes", ""]) {
      process.env[FF_WALLET] = v
      expect(await call("GET", "/store/hawala/wallet", token("customer", "cus_w"))).toEqual(DISABLED)
    }
  })

  it("a refused request spends no rate-limit budget: the money, bank-link and read limiters all start full when the flag turns on", async () => {
    const who = token("customer", "cus_wallet_budget")
    // Each well past its budget (money 5/min, bank-account 3/h, read 30/min).
    for (let i = 0; i < 8; i++) expect((await call("POST", "/store/hawala/deposit", who)).status).toBe(404)
    for (let i = 0; i < 5; i++) expect((await call("POST", "/store/hawala/bank-accounts", who)).status).toBe(404)
    for (let i = 0; i < 32; i++) expect((await call("GET", "/store/hawala/wallet", who)).status).toBe(404)

    process.env[FF_WALLET] = "true"
    const deposits: number[] = []
    for (let i = 0; i < 6; i++) deposits.push((await call("POST", "/store/hawala/deposit", who)).status)
    expect(deposits).toEqual([200, 200, 200, 200, 200, 429])
    const links: number[] = []
    for (let i = 0; i < 4; i++) links.push((await call("POST", "/store/hawala/bank-accounts", who)).status)
    expect(links).toEqual([200, 200, 200, 429])
    const reads: number[] = []
    for (let i = 0; i < 31; i++) reads.push((await call("GET", "/store/hawala/wallet", who)).status)
    expect(reads.slice(0, 30)).toEqual(Array(30).fill(200))
    expect(reads[30]).toBe(429)
  })

  it("the wallet flag opens nothing else: pools and investments stay on FF_INVESTMENT_POOLS_V1, contributions on both of theirs", async () => {
    process.env[FF_WALLET] = "true"
    const pools = await call("GET", "/store/hawala/pools")
    expect(pools.status).toBe(404)
    expect(pools.body.message).toBe("Feature flag FF_INVESTMENT_POOLS_V1 is disabled")
    const inv = await call("GET", "/store/hawala/investments", token("customer", "cus_w"))
    expect(inv.status).toBe(404)
    expect(inv.body.message).toBe("Feature flag FF_INVESTMENT_POOLS_V1 is disabled")
    expect((await call("POST", "/store/hawala/pools/pool_1/contributions", token("customer", "cus_w"))).status).toBe(404)
  })

  it("with the wallet flag OFF the ungated hawala routes answer exactly as before (their own flags on)", async () => {
    process.env[FF_POOLS] = "true"
    process.env[FF_PARITY] = "true"
    expect(await call("GET", "/store/hawala/pools")).toEqual({ status: 200, body: { reached: "GET /store/hawala/pools", actor: null } })
    expect((await call("GET", "/store/hawala/investments")).status).toBe(401)
    expect((await call("GET", "/store/hawala/investments", token("customer", "cus_i"))).body).toEqual({ reached: "GET /store/hawala/investments", actor: "cus_i" })
    expect((await call("POST", "/store/hawala/investments", token("customer", "cus_i"))).body).toEqual({ reached: "POST /store/hawala/investments", actor: "cus_i" })
    expect((await call("POST", "/store/hawala/pools/pool_1/contributions")).body).toEqual({ reached: "POST /store/hawala/pools/:id/contributions", actor: null })
  })
})

// ===========================================================================
describe("/store/hawala/investments: flag first, then customer", () => {
  it.each(["GET", "POST"] as Verb[])("%s with INVESTMENT_POOLS_V1 off answers 404 feature_disabled to an anonymous caller (not 401)", async (verb) => {
    const res = await call(verb, "/store/hawala/investments")
    expect(res.status).toBe(404)
    expect(res.body.type).toBe("feature_disabled")
  })

  it.each(["GET", "POST"] as Verb[])("%s with the flag on: 401 anonymous, reached with a customer", async (verb) => {
    process.env[FF_POOLS] = "true"
    expect((await call(verb, "/store/hawala/investments")).status).toBe(401)
    const ok = await call(verb, "/store/hawala/investments", token("customer", "cus_inv"))
    expect(ok.status).toBe(200)
    expect(ok.body.actor).toBe("cus_inv")
  })

  it("only the literal string \"true\" opens it", async () => {
    process.env[FF_POOLS] = "1"
    expect((await call("GET", "/store/hawala/investments", token("customer", "cus_inv"))).status).toBe(404)
  })
})

// ===========================================================================
describe("public by design stays public", () => {
  it("GET /store/hawala/pools (flag on) is reached anonymously", async () => {
    process.env[FF_POOLS] = "true"
    const res = await call("GET", "/store/hawala/pools")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ reached: "GET /store/hawala/pools", actor: null })
  })

  it("POST /store/hawala/pools/:id/contributions (both flags on) admits a guest, and carries the customer when one is signed in", async () => {
    process.env[FF_POOLS] = "true"
    process.env[FF_PARITY] = "true"
    const guest = await call("POST", "/store/hawala/pools/pool_1/contributions")
    expect(guest.status).toBe(200)
    expect(guest.body.actor).toBeNull()
    const signedIn = await call("POST", "/store/hawala/pools/pool_1/contributions", token("customer", "cus_con"))
    expect(signedIn.status).toBe(200)
    expect(signedIn.body.actor).toBe("cus_con")
  })

  it.each([
    ["GET", "/store/mutual-aid/requests"],
    ["GET", "/store/mutual-aid/offers"],
    ["GET", "/store/collective/demand-pools"],
    ["GET", "/store/collective/demand-pools/t_id"],
    ["GET", "/store/collective/buyer-networks/t_id"],
  ] as [Verb, string][])("%s %s is reached anonymously", async (verb, url) => {
    const res = await call(verb, url)
    expect(res.status).toBe(200)
    expect(res.body.actor).toBeNull()
  })
})

// ===========================================================================
describe("/deliveries/:id/* — the auth hole, closed fail-closed", () => {
  const all = ["accept", "prepare", "ready", "claim", "pick-up", "complete"]

  it.each([...all.map((s) => ["POST", s]), ["GET", "subscribe"]] as [Verb, string][])(
    "%s /deliveries/:id/%s: 401 anonymous, 401 for a customer token, never reaching the handler",
    async (verb, step) => {
      expect(await call(verb, `/deliveries/dlv_mine/${step}`)).toEqual({ status: 401, body: { message: "Unauthorized" } })
      expect((await call(verb, `/deliveries/dlv_mine/${step}`, token("customer", "cus_1"))).status).toBe(401)
      expect(resolved).not.toContain(DELIVERY_MODULE)
      expect(resolved).not.toContain(RESTAURANT_MODULE)
    }
  )

  describe.each(["accept", "prepare", "ready"])("POST /deliveries/:id/%s (restaurant)", (step) => {
    it("a driver token is the wrong actor — 401", async () => {
      expect((await call("POST", `/deliveries/dlv_mine/${step}`, token("driver", "drv_1"))).status).toBe(401)
    })

    it("the delivery's own restaurant admin reaches the handler, through the real guard", async () => {
      const res = await call("POST", `/deliveries/dlv_mine/${step}`, token("restaurant", "radm_1"))
      expect(res.status).toBe(200)
      expect(res.body.actor).toBe("radm_1")
      expect(resolved).toContain(RESTAURANT_MODULE)
    })

    it("another restaurant's delivery and a missing delivery answer the same 403", async () => {
      const theirs = await call("POST", `/deliveries/dlv_theirs/${step}`, token("restaurant", "radm_1"))
      const missing = await call("POST", `/deliveries/dlv_nope/${step}`, token("restaurant", "radm_1"))
      expect(theirs.status).toBe(403)
      expect(missing).toEqual(theirs)
      expect(theirs.body.type).toBe("not_allowed")
    })

    it("a restaurant token whose admin cannot be resolved is 403, not 500", async () => {
      expect((await call("POST", `/deliveries/dlv_mine/${step}`, token("restaurant", "radm_ghost"))).status).toBe(403)
    })
  })

  it("POST /deliveries/:id/claim: any driver reaches it (claiming is how a driver is assigned)", async () => {
    const res = await call("POST", "/deliveries/dlv_theirs/claim", token("driver", "drv_1"))
    expect(res.status).toBe(200)
    expect(res.body.actor).toBe("drv_1")
    expect((await call("POST", "/deliveries/dlv_theirs/claim", token("restaurant", "radm_1"))).status).toBe(401)
  })

  describe.each(["pick-up", "complete"])("POST /deliveries/:id/%s (driver)", (step) => {
    it("the assigned driver reaches the handler, through the real guard", async () => {
      const res = await call("POST", `/deliveries/dlv_mine/${step}`, token("driver", "drv_1"))
      expect(res.status).toBe(200)
      expect(resolved).toContain(DELIVERY_MODULE)
    })

    it("another driver's delivery and a missing delivery answer the same 403", async () => {
      const theirs = await call("POST", `/deliveries/dlv_theirs/${step}`, token("driver", "drv_1"))
      const missing = await call("POST", `/deliveries/dlv_nope/${step}`, token("driver", "drv_1"))
      expect(theirs.status).toBe(403)
      expect(missing).toEqual(theirs)
    })

    it("a restaurant token is the wrong actor — 401", async () => {
      expect((await call("POST", `/deliveries/dlv_mine/${step}`, token("restaurant", "radm_1"))).status).toBe(401)
    })
  })

  describe("GET /deliveries/:id/subscribe (the delivery's restaurant admin or assigned driver)", () => {
    it("its own restaurant admin and its own driver reach the handler, through the real guards", async () => {
      const r = await call("GET", "/deliveries/dlv_mine/subscribe", token("restaurant", "radm_1"))
      expect(r.status).toBe(200)
      expect(r.body.actor).toBe("radm_1")
      expect(resolved).toContain(RESTAURANT_MODULE)
      const d = await call("GET", "/deliveries/dlv_mine/subscribe", token("driver", "drv_1"))
      expect(d.status).toBe(200)
      expect(d.body.actor).toBe("drv_1")
      expect(resolved).toContain(DELIVERY_MODULE)
    })

    it("another restaurant's or driver's delivery, a missing one, and one with no transaction id answer the same 403", async () => {
      const theirsR = await call("GET", "/deliveries/dlv_theirs/subscribe", token("restaurant", "radm_1"))
      const theirsD = await call("GET", "/deliveries/dlv_theirs/subscribe", token("driver", "drv_1"))
      const missing = await call("GET", "/deliveries/dlv_nope/subscribe", token("driver", "drv_1"))
      const noTxR = await call("GET", "/deliveries/dlv_notx/subscribe", token("restaurant", "radm_1"))
      const noTxD = await call("GET", "/deliveries/dlv_notx/subscribe", token("driver", "drv_1"))
      expect(theirsR.status).toBe(403)
      expect(theirsR.body.type).toBe("not_allowed")
      for (const r of [theirsD, missing, noTxR, noTxD]) expect(r).toEqual(theirsR)
    })
  })
})

// ===========================================================================
describe("rate limiters: present where declared, with the declared budgets", () => {
  const expected: [string, Verb, keyof typeof limiters][] = [
    ["/store/hawala/deposit", "POST", "storeHawalaMoneyRateLimiter"],
    ["/store/hawala/withdraw", "POST", "storeHawalaMoneyRateLimiter"],
    ["/store/hawala/investments", "POST", "storeHawalaInvestRateLimiter"],
    ["/store/hawala/bank-accounts", "POST", "storeHawalaBankAccountRateLimiter"],
    ["/store/hawala/wallet", "GET", "storeHawalaReadRateLimiter"],
    ["/store/hawala/bank-accounts", "GET", "storeHawalaReadRateLimiter"],
    ["/store/hawala/transactions", "GET", "storeHawalaReadRateLimiter"],
    ["/store/hawala/investments", "GET", "storeHawalaReadRateLimiter"],
    ["/vendor/hawala/payouts", "POST", "vendorHawalaMoneyRateLimiter"],
    ["/vendor/hawala/advances", "POST", "vendorHawalaMoneyRateLimiter"],
    ["/vendor/hawala/payments", "POST", "vendorHawalaMoneyRateLimiter"],
    ["/vendor/hawala/pools/*/withdraw", "POST", "vendorHawalaMoneyRateLimiter"],
    ["/vendor/hawala/pools", "POST", "vendorHawalaPoolCreateRateLimiter"],
    ["/vendor/hawala/**", "GET", "vendorHawalaReadRateLimiter"],
    ["/vendor/wellness/automations/test", "POST", "vendorWellnessTestSendRateLimiter"],
    ["/vendor/wellness/**", "GET", "vendorWellnessReadRateLimiter"],
  ]

  it.each(expected)("%s %s -> %s, in the middleware Medusa loads", (matcher, verb, name) => {
    const limiter: unknown = limiters[name]
    expect(typeof limiter).toBe("function")
    const hit = loaded.find((l) => l.matcher === matcher && (l.methods ?? []).includes(verb) && l.handler === limiter)
    expect(hit).toBeDefined()
  })

  it("the public pools listing and the guest contribution carry no hawala read limiter (anonymous calls arrive from the storefront server's one IP)", () => {
    const read: unknown = limiters.storeHawalaReadRateLimiter
    expect(loaded.filter((l) => l.handler === read).map((l) => l.matcher).sort()).toEqual([
      "/store/hawala/bank-accounts",
      "/store/hawala/investments",
      "/store/hawala/transactions",
      "/store/hawala/wallet",
    ])
  })

  it("an anonymous visitor cannot spend the pools listing for everyone: 40 anonymous GETs from one address all reach it", async () => {
    process.env[FF_POOLS] = "true"
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) statuses.push((await call("GET", "/store/hawala/pools")).status)
    expect(new Set(statuses)).toEqual(new Set([200]))
  })

  it("budgets and key prefixes are the declared ones, and no prefix is shared", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../shared/rate-limiter.ts"), "utf8")
    const budget = (name: string) => {
      const m = src.match(
        new RegExp(`export const ${name} = createRateLimiter\\(\\{\\s*windowMs: ([\\d_]+),\\s*max: (\\d+),\\s*keyPrefix: "([^"]+)",\\s*keyGenerator: actorPathRateLimitKey,`)
      )
      expect(m).not.toBeNull()
      return { windowMs: Number(m![1].replace(/_/g, "")), max: Number(m![2]), keyPrefix: m![3] }
    }
    expect(budget("storeHawalaMoneyRateLimiter")).toMatchObject({ windowMs: 60_000, max: 5 })
    expect(budget("storeHawalaInvestRateLimiter")).toMatchObject({ windowMs: 60_000, max: 10 })
    expect(budget("storeHawalaBankAccountRateLimiter")).toMatchObject({ windowMs: 3_600_000, max: 3 })
    expect(budget("storeHawalaReadRateLimiter")).toMatchObject({ windowMs: 60_000, max: 30 })
    expect(budget("vendorHawalaMoneyRateLimiter")).toMatchObject({ windowMs: 60_000, max: 5 })
    expect(budget("vendorHawalaPoolCreateRateLimiter")).toMatchObject({ windowMs: 3_600_000, max: 10 })
    expect(budget("vendorHawalaReadRateLimiter")).toMatchObject({ windowMs: 60_000, max: 30 })
    expect(budget("vendorWellnessTestSendRateLimiter")).toMatchObject({ windowMs: 60_000, max: 5 })
    expect(budget("vendorWellnessReadRateLimiter")).toMatchObject({ windowMs: 60_000, max: 60 })

    // Every exported limiter's prefix (the @example in the file's docs is not one).
    const prefixes = src
      .split(/\nexport const /)
      .filter((chunk) => /^\w+ = createRateLimiter\(/.test(chunk))
      .map((chunk) => chunk.match(/keyPrefix: "([^"]+)"/)?.[1])
    expect(prefixes.length).toBe(20)
    expect(prefixes).not.toContain(undefined)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it("the 6th deposit in a minute is refused for that customer only, and does not spend the shared 'standard' bucket", async () => {
    process.env[FF_POOLS] = "true"
    process.env[FF_PARITY] = "true"
    process.env[FF_WALLET] = "true"
    const a = token("customer", "cus_rl_a")
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await call("POST", "/store/hawala/deposit", a)).status)
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
    const refused = await call("POST", "/store/hawala/deposit", a)
    expect(refused.body.type).toBe("rate_limit_exceeded")

    // Same IP, different customer: keyed on the actor, not the address.
    expect((await call("POST", "/store/hawala/deposit", token("customer", "cus_rl_b"))).status).toBe(200)
    // Its own path: withdraw is not spent by deposits.
    expect((await call("POST", "/store/hawala/withdraw", a)).status).toBe(200)
    // The contributions route's standardRateLimiter bucket is untouched.
    expect((await call("POST", "/store/hawala/pools/pool_1/contributions", a)).status).toBe(200)
  })
})
