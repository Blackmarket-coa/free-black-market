import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import { SUPPLIER_FORWARDING_MODULE } from "../../modules/supplier-forwarding"
import { ManualFulfillmentStatus } from "../../modules/supplier-forwarding/models"
import {
  SUPPLIER_WEBHOOK_SECRET_ENV,
  SUPPLIER_WEBHOOK_SIGNATURE_HEADER,
  signSupplierWebhookBody,
  supplierWebhookKey,
} from "../../modules/supplier-forwarding/webhook-auth"
import { makeInMemorySupplierForwarding } from "../../modules/supplier-forwarding/__tests__/in-memory-supplier-forwarding"

/**
 * `POST /webhooks/suppliers/status` through the real middleware chain.
 *
 * The handler verifies an HMAC over the raw request bytes, so it only works
 * if `src/api/middlewares.ts` gives this path `bodyParser.preserveRawBody`;
 * and its rate limit lives in that file too. Neither is visible to a test that
 * calls the handler directly (route.unit.spec.ts beside the route), so this
 * one assembles the chain the way Medusa's ApiLoader does (router.js):
 *
 *   - Medusa's own MiddlewareFileLoader scanning `src/api`;
 *   - its body-parser stack (`createBodyParserMiddlewaresStack`) mounted on
 *     "/" and choosing each request's parser config from the loaded
 *     bodyParser routes through a RoutesFinder, sorted as router.js sorts it;
 *   - the loaded `/webhooks/suppliers` entries and the REAL route handler,
 *     sorted by RoutesSorter and registered per verb as router.js does;
 *   - the rate limiter on the in-memory store.
 *
 * Every request comes from 127.0.0.1, so they share one limiter bucket.
 */

const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL
const ORIGINAL_SECRET = process.env[SUPPLIER_WEBHOOK_SECRET_ENV]
const SECRET = "supplier-webhook-chain-secret-0123456789abcdef"
process.env[SUPPLIER_WEBHOOK_SECRET_ENV] = SECRET

const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
const { MiddlewareFileLoader } = require(path.join(httpDir, "middleware-file-loader")) as {
  MiddlewareFileLoader: new () => {
    scanDir(dir: string): Promise<void>
    getMiddlewares(): LoadedMiddleware[]
    getBodyParserConfigRoutes(): BodyParserRoute[]
  }
}
const { RoutesSorter } = require(path.join(httpDir, "routes-sorter")) as {
  RoutesSorter: new (routes: unknown[]) => { sort(order?: string[]): unknown[] }
}
const { RoutesFinder } = require(path.join(httpDir, "routes-finder")) as {
  RoutesFinder: new (routes: unknown[]) => unknown
}
const { createBodyParserMiddlewaresStack } = require(path.join(httpDir, "middlewares", "bodyparser")) as {
  createBodyParserMiddlewaresStack: (route: string, finder: unknown) => Handler[]
}
const { wrapHandler } = require(path.join(httpDir, "utils", "wrap-handler")) as {
  wrapHandler: (fn: Handler) => Handler
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown
type LoadedMiddleware = { handler: Handler; matcher: string; methods?: string[] }
type BodyParserRoute = { matcher: string; methods: string[]; config: unknown }
type RouteEntry = { isRoute: true; matcher: string; method: string; handler: Handler }

const API_DIR = path.resolve(__dirname, "..")
const ACME = "sup_acme"
const ORDER = "order_01CHAIN"

const store = makeInMemorySupplierForwarding({
  profiles: [{ supplier_id: ACME, display_name: "Acme", contact_method: "manual", is_active: true }],
  attempts: [{ order_id: ORDER, supplier_id: ACME, status: "pending" }],
})

let server: http.Server
let baseUrl = ""
let sent = 0

beforeAll(async () => {
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)

  const bodyParserFinder = new RoutesFinder(
    new RoutesSorter(loader.getBodyParserConfigRoutes()).sort(["static", "params", "regex", "wildcard", "global"])
  )
  const loaded = loader.getMiddlewares().filter((m) => String(m.matcher).startsWith("/webhooks/suppliers"))
  // The route module is required, not imported, so this file loads it the way
  // Medusa's RoutesLoader does: after the middleware file.
  const { POST } = require("../webhooks/suppliers/status/route") as { POST: Handler }
  const route: RouteEntry = { isRoute: true, matcher: "/webhooks/suppliers/status", method: "POST", handler: POST }

  const app = express()
  app.use((req, _res, next) => {
    ;(req as unknown as { scope: unknown }).scope = {
      resolve(key: string) {
        if (key === SUPPLIER_FORWARDING_MODULE) return store.service
        throw new Error(`unexpected container key in spec: ${key}`)
      },
    }
    next()
  })
  app.use("/", createBodyParserMiddlewaresStack("/", bodyParserFinder))

  const verbs = app as unknown as Record<string, (p: string, h: Handler) => void>
  for (const entry of new RoutesSorter([...loaded, route]).sort() as Array<LoadedMiddleware | RouteEntry>) {
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
  if (ORIGINAL_SECRET === undefined) delete process.env[SUPPLIER_WEBHOOK_SECRET_ENV]
  else process.env[SUPPLIER_WEBHOOK_SECRET_ENV] = ORIGINAL_SECRET
})

/** Posts `raw` byte for byte; `sign` false sends no signature header. */
async function post(raw: string, sign: boolean | string = true) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (sign !== false) {
    headers[SUPPLIER_WEBHOOK_SIGNATURE_HEADER] =
      typeof sign === "string" ? sign : signSupplierWebhookBody(supplierWebhookKey(SECRET, ACME), raw)
  }
  sent++
  const res = await fetch(`${baseUrl}/webhooks/suppliers/status`, { method: "POST", headers, body: raw })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body, limit: res.headers.get("x-ratelimit-limit") }
}

const payload = (status: ManualFulfillmentStatus) => JSON.stringify({ order_id: ORDER, supplier_id: ACME, status })

describe("the supplier status webhook through src/api/middlewares.ts", () => {
  it("accepts a correctly signed request: the raw body reaches the handler intact", async () => {
    // Whitespace the JSON parser discards: the signature covers the bytes on
    // the wire, so only a preserved raw body can verify it.
    const raw = `{ "order_id": "${ORDER}",  "supplier_id": "${ACME}", "status": "acknowledged" }`
    const res = await post(raw)
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
    expect(store.tables.updates.map((u) => u.status)).toEqual([ManualFulfillmentStatus.ACKNOWLEDGED])
  })

  it("refuses unsigned and forged requests with 401 and writes nothing", async () => {
    const before = store.tables.updates.length
    expect((await post(payload(ManualFulfillmentStatus.IN_PROGRESS), false)).status).toBe(401)
    expect((await post(payload(ManualFulfillmentStatus.IN_PROGRESS), "0".repeat(64))).status).toBe(401)
    expect(store.tables.updates).toHaveLength(before)
  })

  it("rate limits per address in its own 120-per-minute bucket", async () => {
    const first = await post(payload(ManualFulfillmentStatus.IN_PROGRESS), false)
    expect(first.limit).toBe("120")
    const seen: number[] = []
    while (sent < 120) seen.push((await post(payload(ManualFulfillmentStatus.IN_PROGRESS), false)).status)
    expect(seen.filter((s) => s === 429)).toEqual([])
    expect((await post(payload(ManualFulfillmentStatus.IN_PROGRESS), false)).status).toBe(429)
  })
})
