import http from "http"
import path from "path"
import type { AddressInfo } from "net"
import express from "express"
import type { NextFunction, Request, Response } from "express"

/**
 * Storefront customers cannot write the server-owned identity keys
 * (`blackout_user_id`, `mxid`, `mxid_source`) into their own metadata.
 *
 * Why it matters: the Blackout hosted checkout's mxid fallback
 * (lib/blackout-identity.ts) adopts the customer whose `metadata.mxid` matches
 * the member, and its "never re-stamp another member's customer" guard reads
 * `metadata.blackout_user_id`. Both were writable through Medusa core's
 * POST /store/customers and POST /store/customers/me (free-form `metadata`,
 * merged into the stored record), so a storefront customer could plant
 * another person's mxid and receive that person's Blackout purchase.
 *
 * Real: Medusa's MiddlewareFileLoader scanning `src/api` (so the entries are
 * the ones `src/api/middlewares.ts` really exports, with their real matchers
 * and methods), Medusa's RoutesSorter, express routing, and every middleware
 * bound under /store/customers (rate limiter and email normaliser included).
 * Stand-in: the two core route handlers, as sentinels reporting they were
 * reached.
 */

// The limiter store is chosen when the first limiter is created.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL

const httpDir = path.dirname(require.resolve("@medusajs/framework/http"))
const { MiddlewareFileLoader } = require(path.join(httpDir, "middleware-file-loader")) as {
  MiddlewareFileLoader: new () => { scanDir(dir: string): Promise<void>; getMiddlewares(): LoadedMiddleware[] }
}
const { RoutesSorter } = require(path.join(httpDir, "routes-sorter")) as {
  RoutesSorter: new (routes: SortableEntry[]) => { sort(): SortableEntry[] }
}
const { wrapHandler } = require(path.join(httpDir, "utils", "wrap-handler")) as {
  wrapHandler: (fn: Handler) => Handler
}
const { refuseServerOwnedCustomerMetadata, SERVER_OWNED_CUSTOMER_METADATA_KEYS } =
  require("../server-owned-customer-metadata") as typeof import("../server-owned-customer-metadata")

type Handler = (req: Request, res: Response, next: NextFunction) => unknown
type LoadedMiddleware = { handler: Handler; matcher: string; methods?: string[] }
type SentinelRoute = { isRoute: true; matcher: string; method: string; handler: Handler }
type SortableEntry = LoadedMiddleware | SentinelRoute

const API_DIR = path.resolve(__dirname, "..", "..")
const PATHS = ["/store/customers", "/store/customers/me"]

let loaded: LoadedMiddleware[] = []
let server: http.Server
let baseUrl = ""
let reached: string[] = []

beforeAll(async () => {
  const loader = new MiddlewareFileLoader()
  await loader.scanDir(API_DIR)
  loaded = loader.getMiddlewares()

  const sentinels: SentinelRoute[] = PATHS.flatMap((matcher) =>
    ["GET", "POST"].map((method) => ({
      isRoute: true as const,
      matcher,
      method,
      handler: (_req: Request, res: Response) => {
        reached.push(`${method} ${matcher}`)
        res.status(200).json({ reached: `${method} ${matcher}` })
      },
    }))
  )
  const customerMiddlewares = loaded.filter((m) => String(m.matcher).startsWith("/store/customers"))
  const sorted = new RoutesSorter([...customerMiddlewares, ...sentinels]).sort()

  const app = express()
  app.use(express.json())
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
  reached = []
})

async function send(method: string, p: string, body?: unknown) {
  const r = await fetch(`${baseUrl}${p}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

describe("server-owned customer metadata — bound by src/api/middlewares.ts", () => {
  it("is registered for POST on exactly /store/customers and /store/customers/me", () => {
    const bound = loaded
      .filter((m) => (m.handler as unknown) === refuseServerOwnedCustomerMetadata)
      .map((m) => `${(m.methods ?? []).join(",")} ${m.matcher}`)
      .sort()
    expect(bound).toEqual(["POST /store/customers", "POST /store/customers/me"])
  })

  it.each(PATHS.flatMap((p) => SERVER_OWNED_CUSTOMER_METADATA_KEYS.map((key) => [p, key] as const)))(
    "POST %s with metadata.%s is refused 400 before the route",
    async (p, key) => {
      for (const value of ["@victim:blackout", ""]) {
        const res = await send("POST", p, { first_name: "X", metadata: { note: "hi", [key]: value } })
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ type: "invalid_data", message: `metadata.${key} cannot be set from the store API.` })
      }
      expect(reached).toEqual([])
    }
  )

  it.each(PATHS)("POST %s without those keys reaches the route, as before (the storefront's own shape)", async (p) => {
    expect((await send("POST", p, { first_name: "A", last_name: "B", phone: "1" })).status).toBe(200)
    expect((await send("POST", p, { first_name: "A", metadata: { favourite_colour: "green" } })).status).toBe(200)
    expect((await send("POST", p, { first_name: "A", metadata: null })).status).toBe(200)
    expect(reached).toEqual([`POST ${p}`, `POST ${p}`, `POST ${p}`])
  })

  it("GET /store/customers/me is untouched", async () => {
    expect((await send("GET", "/store/customers/me")).status).toBe(200)
    expect(reached).toEqual(["GET /store/customers/me"])
  })
})

describe("refuseServerOwnedCustomerMetadata — also reads validatedBody", () => {
  it("refuses when only the validated body carries a reserved key (ordered after Medusa's validator)", () => {
    const res = { statusCode: 0, body: undefined as unknown } as {
      statusCode: number
      body: unknown
      status: (c: number) => typeof res
      json: (b: unknown) => typeof res
    }
    res.status = (c) => {
      res.statusCode = c
      return res
    }
    res.json = (b) => {
      res.body = b
      return res
    }
    const next = jest.fn()
    refuseServerOwnedCustomerMetadata(
      { body: {}, validatedBody: { metadata: { mxid: "@v:blackout" } } } as never,
      res as never,
      next
    )
    expect(res.statusCode).toBe(400)
    expect(next).not.toHaveBeenCalled()
  })
})
