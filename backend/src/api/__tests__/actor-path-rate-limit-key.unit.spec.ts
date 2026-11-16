import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"

/**
 * The per-actor, per-endpoint limiters (`actorPathRateLimitKey`) on the money
 * paths, the bank-link start, the data-rights endpoints, the wellness test
 * send and the account surface.
 *
 * Their key was the raw `req.path`. Express matches routes case-insensitively,
 * ignores a trailing slash and percent-decodes params, so `/STORE/hawala/deposit`,
 * `/store/hawala/deposit/` and `/vendor/hawala/pools/pool%5F1/withdraw` each
 * reached the same handler, for the same resource, with a fresh budget: the
 * 5-per-minute ACH budget was 5 per spelling. The same defect the delivery
 * proof limiter had (store-delivery-proof-rate-limit.unit.spec.ts).
 *
 * What is real here, as in store-customer-rate-limits.unit.spec.ts: Medusa's
 * MiddlewareFileLoader scanning `src/api`, its RoutesSorter, entries
 * registered on express the way ApiLoader does it (method-less via
 * `app.use`, the rest per verb), the framework's optional /store customer
 * authenticate, the hawala feature-flag and customer guards, and our limiters
 * on the in-memory store. Stand-ins: the route handlers (sentinels), and
 * `authenticate("seller", ["bearer"])` on /vendor in place of Mercur's seller
 * auth, which lives outside `src/api`.
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
type Verb = "GET" | "POST"

const API_DIR = path.resolve(__dirname, "..")
const JWT_SECRET = "actor-path-rate-limit-key-spec-secret"
const PREFIXES = ["/store/hawala", "/store/customers", "/vendor/hawala", "/vendor/wellness"]
const FLAGS = [PHASE0_FEATURE_FLAGS.CUSTOMER_WALLET_V1, PHASE0_FEATURE_FLAGS.INVESTMENT_POOLS_V1]

const ROUTES: [string, Verb][] = [
  ["/store/hawala/deposit", "POST"],
  ["/store/hawala/withdraw", "POST"],
  ["/store/hawala/bank-accounts", "POST"],
  ["/store/hawala/wallet", "GET"],
  ["/store/customers/me", "GET"],
  ["/store/customers/me/addresses/:address_id", "GET"],
  ["/store/customers/me/data-export", "GET"],
  ["/store/customers/me/deletion", "POST"],
  ["/vendor/hawala/payouts", "POST"],
  ["/vendor/hawala/pools/:id/withdraw", "POST"],
  ["/vendor/hawala/earnings", "GET"],
  ["/vendor/wellness/automations/test", "POST"],
  ["/vendor/wellness/classes", "GET"],
]

function token(actorType: "customer" | "seller", actorId: string): string {
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
  for (const flag of FLAGS) process.env[flag] = "true"

  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  const loaded = loader.getMiddlewares().filter((m) => PREFIXES.some((p) => String(m.matcher).startsWith(p)))

  const sentinels: SentinelRoute[] = ROUTES.map(([matcher, method]) => ({
    isRoute: true as const,
    matcher,
    method,
    handler: (req: Request, res: Response) => {
      const ctx = (req as Request & { auth_context?: { actor_id?: string } }).auth_context
      res.status(200).json({ reached: `${method} ${matcher}`, actor: ctx?.actor_id ?? null, params: req.params })
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
  // Stand-in for Mercur's required seller auth on /vendor/*.
  app.use("/vendor", authenticate("seller", ["bearer"]) as unknown as Handler)

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
  for (const flag of FLAGS) delete process.env[flag]
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
  return { status: res.status, body }
}

async function statuses(n: number, method: Verb, url: string, bearer?: string): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((await call(method, url, bearer)).status)
  return out
}

type Family = {
  limiter: string
  verb: Verb
  matcher: string
  url: string
  max: number
  actorType: "customer" | "seller"
  respellings: string[]
}

// Each family's endpoint, its budget, and spellings of the same request.
// Every respelling is first shown to reach the same handler with the same
// params, so a 429 on it is the shared budget and not a missed route.
const FAMILIES: Family[] = [
  {
    limiter: "storeHawalaMoneyRateLimiter",
    verb: "POST",
    matcher: "/store/hawala/deposit",
    url: "/store/hawala/deposit",
    max: 5,
    actorType: "customer",
    respellings: ["/STORE/hawala/deposit", "/store/Hawala/Deposit", "/store/hawala/deposit/", "/STORE/HAWALA/DEPOSIT/"],
  },
  {
    limiter: "storeHawalaBankAccountRateLimiter",
    verb: "POST",
    matcher: "/store/hawala/bank-accounts",
    url: "/store/hawala/bank-accounts",
    max: 3,
    actorType: "customer",
    respellings: ["/store/hawala/Bank-Accounts", "/store/hawala/bank-accounts/", "/Store/Hawala/BANK-ACCOUNTS/"],
  },
  {
    limiter: "storeCustomerDataRightsRateLimiter",
    verb: "GET",
    matcher: "/store/customers/me/data-export",
    url: "/store/customers/me/data-export",
    max: 5,
    actorType: "customer",
    respellings: ["/store/customers/me/Data-Export", "/STORE/customers/me/data-export/", "/store/Customers/ME/data-export"],
  },
  {
    limiter: "storeCustomerDataRightsRateLimiter",
    verb: "POST",
    matcher: "/store/customers/me/deletion",
    url: "/store/customers/me/deletion",
    max: 5,
    actorType: "customer",
    respellings: ["/store/customers/me/DELETION", "/store/customers/me/deletion/", "/Store/Customers/Me/Deletion/"],
  },
  {
    // Method-less mount (`app.use`): req.path is only what follows the
    // prefix, and req.baseUrl is the prefix as the caller spelled it.
    limiter: "storeCustomerAccountRateLimiter",
    verb: "GET",
    matcher: "/store/customers/me/addresses/:address_id",
    url: "/store/customers/me/addresses/addr_1",
    max: 120,
    actorType: "customer",
    respellings: [
      "/STORE/Customers/me/addresses/addr_1",
      "/store/customers/me/addresses/addr_1/",
      "/store/customers/me/addresses/addr%5F1",
      "/store/customers/ME/Addresses/%61ddr%5f1/",
    ],
  },
  {
    limiter: "vendorHawalaMoneyRateLimiter",
    verb: "POST",
    matcher: "/vendor/hawala/payouts",
    url: "/vendor/hawala/payouts",
    max: 5,
    actorType: "seller",
    respellings: ["/VENDOR/hawala/payouts", "/vendor/hawala/Payouts/", "/Vendor/Hawala/PAYOUTS"],
  },
  {
    // A wildcard segment: the pool id reaches the handler decoded.
    limiter: "vendorHawalaMoneyRateLimiter",
    verb: "POST",
    matcher: "/vendor/hawala/pools/:id/withdraw",
    url: "/vendor/hawala/pools/pool_1/withdraw",
    max: 5,
    actorType: "seller",
    respellings: [
      "/vendor/hawala/pools/pool%5F1/withdraw",
      "/vendor/hawala/pools/%70ool_1/withdraw",
      "/VENDOR/hawala/pools/pool_1/withdraw",
      "/vendor/hawala/pools/pool_1/withdraw/",
      "/vendor/Hawala/Pools/pool%5f1/Withdraw/",
    ],
  },
  {
    limiter: "vendorWellnessTestSendRateLimiter",
    verb: "POST",
    matcher: "/vendor/wellness/automations/test",
    url: "/vendor/wellness/automations/test",
    max: 5,
    actorType: "seller",
    respellings: ["/vendor/wellness/automations/TEST", "/vendor/wellness/automations/test/", "/VENDOR/Wellness/Automations/Test/"],
  },
]

describe("actorPathRateLimitKey: one budget per endpoint, however the URL is spelled", () => {
  it.each(FAMILIES.map((f) => [f.limiter, f.verb, f.url, f] as const))(
    "%s (%s %s): re-cased, trailing-slash and percent-encoded spellings share the budget",
    async (_limiter, verb, url, family) => {
      const tag = `${family.limiter}_${family.url.replace(/\W+/g, "_")}`
      const canonical = await call(verb, url, token(family.actorType, `probe_${tag}`))
      expect(canonical.status).toBe(200)
      expect(canonical.body.reached).toBe(`${verb} ${family.matcher}`)

      // Each spelling reaches the same handler with the same params, for a
      // caller whose budget is untouched.
      for (const [i, spelling] of family.respellings.entries()) {
        const probe = await call(verb, spelling, token(family.actorType, `probe_${tag}_${i}`))
        expect([spelling, probe.status, probe.body.reached, probe.body.params]).toEqual([
          spelling,
          200,
          `${verb} ${family.matcher}`,
          canonical.body.params,
        ])
      }

      // One caller spends the budget on the plain URL...
      const who = token(family.actorType, `spender_${tag}`)
      const seen = await statuses(family.max + 1, verb, url, who)
      expect(seen.slice(0, family.max).every((s) => s === 200)).toBe(true)
      expect(seen[family.max]).toBe(429)
      // ...and no spelling of the same request buys another.
      for (const spelling of family.respellings) {
        expect([spelling, (await call(verb, spelling, who)).status]).toEqual([spelling, 429])
      }
    }
  )

  it("still budgets each endpoint and each resource separately", async () => {
    const seller = token("seller", "sel_separate")
    await statuses(5, "POST", "/vendor/hawala/pools/pool_a/withdraw", seller)
    expect((await call("POST", "/vendor/hawala/pools/POOL_A/withdraw/", seller)).status).toBe(429)
    expect((await call("POST", "/vendor/hawala/pools/pool_b/withdraw", seller)).status).toBe(200)
    expect((await call("POST", "/vendor/hawala/payouts", seller)).status).toBe(200)

    const customer = token("customer", "cus_separate")
    await statuses(5, "POST", "/store/hawala/deposit", customer)
    expect((await call("POST", "/store/hawala/Deposit/", customer)).status).toBe(429)
    expect((await call("POST", "/store/hawala/withdraw", customer)).status).toBe(200)
  })

  it("a percent-encoded literal segment does not reach the handler at all, so it is not a budget either", async () => {
    // Express matches literal segments against the raw path; only params
    // are decoded. With an untouched budget these are 404, not 200.
    for (const [verb, url, actorType] of [
      ["POST", "/store/hawala/%64eposit", "customer"],
      ["POST", "/vendor/hawala/p%61youts", "seller"],
    ] as const) {
      const res = await call(verb, url, token(actorType, `literal_${url.replace(/\W+/g, "_")}`))
      expect([url, res.status, res.body.reached]).toEqual([url, 404, undefined])
    }
  })
})

describe("canonicalRequestPath", () => {
  // Required here, not imported: the limiter store is chosen on first import.
  const { canonicalRequestPath, actorPathRateLimitKey } = require("../../shared/rate-limiter") as {
    canonicalRequestPath: (req: unknown) => string
    actorPathRateLimitKey: (req: unknown) => string
  }

  it.each([
    [{ baseUrl: "", path: "/STORE/hawala/Deposit/" }, "/store/hawala/deposit"],
    [{ baseUrl: "/STORE/Customers/me", path: "/orders/" }, "/store/customers/me/orders"],
    [{ baseUrl: "/store/customers/me", path: "/" }, "/store/customers/me"],
    [{ baseUrl: "", path: "/vendor/hawala/pools/pool%5F1/withdraw" }, "/vendor/hawala/pools/pool_1/withdraw"],
    [{ baseUrl: "", path: "/vendor/hawala/pools/%zz/withdraw" }, "/vendor/hawala/pools/%zz/withdraw"],
    [{ baseUrl: "", path: "/store//hawala///deposit" }, "/store/hawala/deposit"],
    [{ baseUrl: "", path: "/" }, "/"],
    [{ path: "/store/hawala/wallet" }, "/store/hawala/wallet"],
  ])("%j -> %s", (req, expected) => {
    expect(canonicalRequestPath(req)).toBe(expected)
  })

  it("keys on the actor and the canonical path", () => {
    expect(
      actorPathRateLimitKey({ auth_context: { actor_id: "cus_k" }, baseUrl: "", path: "/STORE/hawala/deposit/" })
    ).toBe("actor:cus_k:/store/hawala/deposit")
  })
})
