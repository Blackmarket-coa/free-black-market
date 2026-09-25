import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  connectStoreCorsGate,
  installConnectStoreCorsHook,
  isConnectRoute,
  isMedusaStoreCors,
  resetConnectOriginCache,
} from "../connect-cors"
import { EMBED_KEYS_MODULE } from "../../../modules/embed-keys"

/**
 * The connect.js gate wrapped around Medusa's /store CORS middleware (see
 * connect-cors.ts for why it has to live there). These specs drive the gate
 * with a hand-rolled req/res and a stub standing in for Medusa's store CORS,
 * asserting which one answered and what it did to the request. The real
 * framework ordering (store CORS -> publishable-key check -> route) is covered
 * end to end in connect-cors.framework.unit.spec.ts.
 */

const VENDOR_ORIGIN = "https://www.shop.example.com"
const OTHER_VENDOR_ORIGIN = "https://other-vendor.example.org"
const UNREGISTERED_ORIGIN = "https://evil.example.net"
const FIRST_PARTY_ORIGIN = "https://freeblackmarket.com"
const GOOD_KEY = "pk_live_good"
const REVOKED_KEY = "pk_live_revoked"
const PLATFORM_PK = "pk_platform_storefront"

type HarnessOpts = {
  method?: string
  path?: string
  origin?: string
  requestMethod?: string
  authorization?: string
  headers?: Record<string, string>
}

const makeHarness = (opts: HarnessOpts = {}) => {
  const embedKeys = {
    verifyKey: jest.fn(async (plaintext: string) =>
      plaintext === GOOD_KEY ? { id: "ek_1", seller_id: "sel_1" } : null
    ),
  }
  const query = {
    graph: jest.fn(async (args: { filters?: { seller_id?: string } }) => {
      // Key's own vendor (resolveEmbedContext) vs. the all-vendor union
      // (preflight lookup).
      if (args.filters?.seller_id === "sel_1") {
        return { data: [{ connect_domains: ["shop.example.com"] }] }
      }
      return {
        data: [
          { connect_domains: ["shop.example.com"] },
          { connect_domains: ["other-vendor.example.org"] },
          { connect_domains: null },
        ],
      }
    }),
  }
  const config = {
    projectConfig: { http: { storeCors: `${FIRST_PARTY_ORIGIN},/\\.fbm-preview\\.dev$/` } },
  }

  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.origin) headers.origin = opts.origin
  if (opts.requestMethod) headers["access-control-request-method"] = opts.requestMethod
  if (opts.authorization) headers.authorization = opts.authorization

  const fullPath = opts.path ?? "/store/vendors/shop"
  const req = {
    method: opts.method ?? "GET",
    baseUrl: "/store",
    path: fullPath.replace(/^\/store/, ""),
    headers,
    scope: {
      resolve: (key: string) => {
        if (key === EMBED_KEYS_MODULE) return embedKeys
        if (key === ContainerRegistrationKeys.QUERY) return query
        if (key === ContainerRegistrationKeys.CONFIG_MODULE) return config
        return undefined
      },
    },
  }

  const resHeaders: Record<string, string> = {}
  const res = {
    statusCode: 200,
    ended: false,
    setHeader: jest.fn((k: string, v: string) => {
      resHeaders[k.toLowerCase()] = v
    }),
    getHeader: (k: string) => resHeaders[k.toLowerCase()],
    end: jest.fn(() => {
      res.ended = true
    }),
  }

  const medusaStoreCors = jest.fn((_req: unknown, _res: unknown, next: () => void) => next())
  const next = jest.fn()
  const gate = connectStoreCorsGate(medusaStoreCors as never)
  const run = () => gate(req as never, res as never, next)

  return { req, res, resHeaders, medusaStoreCors, next, run, embedKeys, query }
}

const preflight = (path: string, origin: string, requestMethod = "GET") =>
  makeHarness({ method: "OPTIONS", path, origin, requestMethod })

const actual = (opts: HarnessOpts) =>
  makeHarness({
    authorization: `PublishableKey ${GOOD_KEY}`,
    origin: VENDOR_ORIGIN,
    ...opts,
  })

const ORIGINAL_ENV = process.env.FBM_CONNECT_PUBLISHABLE_KEY

beforeEach(() => {
  resetConnectOriginCache()
  process.env.FBM_CONNECT_PUBLISHABLE_KEY = PLATFORM_PK
})

afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.FBM_CONNECT_PUBLISHABLE_KEY
  else process.env.FBM_CONNECT_PUBLISHABLE_KEY = ORIGINAL_ENV
})

describe("isConnectRoute", () => {
  it.each([
    ["GET", "/store/vendors/shop"],
    ["GET", "/store/vendors/shop/reviews"],
    ["GET", "/store/vendors/shop/availability"],
    ["GET", "/store/collective/demand-pools"],
    ["POST", "/store/embed/bookings"],
    ["POST", "/store/embed/chat/start"],
    ["POST", "/store/embed/events"],
    ["POST", "/store/embed/drives/checkout"],
  ])("covers %s %s", (method, path) => {
    expect(isConnectRoute(method, path)).toBe(true)
  })

  it.each([
    ["GET", "/store/vendors"],
    ["POST", "/store/vendors/shop"],
    ["GET", "/store/collective/demand-pools/dp_1"],
    ["POST", "/store/collective/demand-pools"],
    ["GET", "/store/embed/bookings"],
    ["POST", "/store/embed/anything-else"],
    ["GET", "/store/products"],
    ["POST", "/store/carts"],
  ])("does not cover %s %s", (method, path) => {
    expect(isConnectRoute(method, path)).toBe(false)
  })
})

describe("preflight", () => {
  it("answers a preflight from a registered vendor origin", async () => {
    const h = preflight("/store/vendors/shop", VENDOR_ORIGIN)
    await h.run()

    expect(h.medusaStoreCors).not.toHaveBeenCalled()
    expect(h.next).not.toHaveBeenCalled()
    expect(h.res.statusCode).toBe(204)
    expect(h.res.ended).toBe(true)
    expect(h.resHeaders["access-control-allow-origin"]).toBe(VENDOR_ORIGIN)
    expect(h.resHeaders["access-control-allow-headers"]).toMatch(/Authorization/)
    expect(h.resHeaders["access-control-allow-headers"]).toMatch(/Content-Type/)
    expect(h.resHeaders["access-control-allow-methods"]).toBe("GET, OPTIONS")
    expect(h.resHeaders["vary"]).toBe("Origin")
    expect(h.resHeaders["access-control-allow-credentials"]).toBeUndefined()
  })

  it("answers a POST preflight for /store/embed/* from any registered vendor origin", async () => {
    const h = preflight("/store/embed/events", OTHER_VENDOR_ORIGIN, "POST")
    await h.run()

    expect(h.res.statusCode).toBe(204)
    expect(h.resHeaders["access-control-allow-origin"]).toBe(OTHER_VENDOR_ORIGIN)
    expect(h.resHeaders["access-control-allow-methods"]).toBe("POST, OPTIONS")
  })

  it("leaves an unregistered origin to Medusa's store CORS (blocked)", async () => {
    const h = preflight("/store/embed/bookings", UNREGISTERED_ORIGIN, "POST")
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.resHeaders["access-control-allow-origin"]).toBeUndefined()
    expect(h.res.ended).toBe(false)
  })

  it("leaves first-party (STORE_CORS) origins to Medusa, string and regex entries", async () => {
    for (const origin of [FIRST_PARTY_ORIGIN, "https://pr-12.fbm-preview.dev"]) {
      const h = preflight("/store/vendors/shop", origin)
      await h.run()
      expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
      expect(h.query.graph).not.toHaveBeenCalled()
    }
  })

  it("does not take over preflights for non-connect.js routes", async () => {
    const h = preflight("/store/carts", VENDOR_ORIGIN, "POST")
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.query.graph).not.toHaveBeenCalled()
  })

  it("does not take over a preflight for a method the SDK never uses", async () => {
    const h = preflight("/store/vendors/shop", VENDOR_ORIGIN, "DELETE")
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
  })

  it("caches the registered-origin union across preflights", async () => {
    const a = preflight("/store/vendors/shop", VENDOR_ORIGIN)
    await a.run()
    // Second harness shares the module-level cache; its own query is unused.
    const b = preflight("/store/vendors/shop", VENDOR_ORIGIN)
    await b.run()

    expect(a.query.graph).toHaveBeenCalledTimes(1)
    expect(b.query.graph).not.toHaveBeenCalled()
    expect(b.res.statusCode).toBe(204)
  })

  it("falls back to Medusa when the origin lookup fails", async () => {
    const h = preflight("/store/vendors/shop", VENDOR_ORIGIN)
    h.query.graph.mockRejectedValueOnce(new Error("db down"))
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.resHeaders["access-control-allow-origin"]).toBeUndefined()
  })
})

describe("actual request", () => {
  it("admits a verified key from its vendor's origin and presents the platform key", async () => {
    const h = actual({ path: "/store/vendors/shop" })
    await h.run()

    expect(h.medusaStoreCors).not.toHaveBeenCalled()
    expect(h.next).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBe(PLATFORM_PK)
    expect(h.resHeaders["access-control-allow-origin"]).toBe(VENDOR_ORIGIN)
    expect(h.resHeaders["vary"]).toBe("Origin")
  })

  it("admits the demand-pools list and embed writes the same way", async () => {
    for (const [method, path] of [
      ["GET", "/store/collective/demand-pools"],
      ["POST", "/store/embed/bookings"],
    ]) {
      const h = actual({ method, path })
      await h.run()
      expect(h.next).toHaveBeenCalledTimes(1)
      expect(h.req.headers["x-publishable-api-key"]).toBe(PLATFORM_PK)
    }
  })

  it("does not touch a request with no embed key", async () => {
    const h = makeHarness({ origin: VENDOR_ORIGIN })
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBeUndefined()
    expect(h.resHeaders["access-control-allow-origin"]).toBeUndefined()
    expect(h.embedKeys.verifyKey).not.toHaveBeenCalled()
  })

  it("does not accept an invalid or revoked key", async () => {
    for (const authorization of [
      `PublishableKey ${REVOKED_KEY}`,
      "PublishableKey pk_live_unknown",
      "Bearer something",
    ]) {
      const h = actual({ authorization })
      await h.run()
      expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
      expect(h.req.headers["x-publishable-api-key"]).toBeUndefined()
      expect(h.resHeaders["access-control-allow-origin"]).toBeUndefined()
    }
  })

  it("does not accept a valid key from an origin outside ITS vendor's connect_domains", async () => {
    // Registered by another vendor — enough for a preflight, not for the key.
    const h = actual({ origin: OTHER_VENDOR_ORIGIN })
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBeUndefined()
    expect(h.resHeaders["access-control-allow-origin"]).toBeUndefined()
  })

  it("does not accept a valid key from an unregistered origin", async () => {
    const h = actual({ origin: UNREGISTERED_ORIGIN })
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBeUndefined()
  })

  it("never swaps the platform key in on other /store routes", async () => {
    const h = actual({ method: "POST", path: "/store/carts" })
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBeUndefined()
    expect(h.embedKeys.verifyKey).not.toHaveBeenCalled()
  })

  it("keeps a publishable key the client sent itself", async () => {
    const h = actual({ headers: { "x-publishable-api-key": "pk_client" } })
    await h.run()

    expect(h.next).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBe("pk_client")
  })

  it("leaves CORS to Medusa for a first-party origin but still presents the platform key", async () => {
    const h = makeHarness({
      origin: FIRST_PARTY_ORIGIN,
      authorization: `PublishableKey ${GOOD_KEY}`,
    })
    h.query.graph.mockResolvedValueOnce({
      data: [{ connect_domains: ["freeblackmarket.com"] }],
    })
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBe(PLATFORM_PK)
    expect(h.resHeaders["access-control-allow-origin"]).toBeUndefined()
  })

  it("still admits the origin but presents no key when FBM_CONNECT_PUBLISHABLE_KEY is unset", async () => {
    delete process.env.FBM_CONNECT_PUBLISHABLE_KEY
    const h = actual({})
    await h.run()

    // Medusa's publishable-key check will reject it; the browser can read why.
    expect(h.next).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBeUndefined()
    expect(h.resHeaders["access-control-allow-origin"]).toBe(VENDOR_ORIGIN)
  })

  it("falls back to Medusa when key verification throws", async () => {
    const h = actual({})
    h.embedKeys.verifyKey.mockRejectedValueOnce(new Error("db down"))
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.req.headers["x-publishable-api-key"]).toBeUndefined()
  })

  it("does not take over requests without an Origin", async () => {
    const h = actual({ origin: undefined })
    delete h.req.headers.origin
    await h.run()

    expect(h.medusaStoreCors).toHaveBeenCalledTimes(1)
    expect(h.embedKeys.verifyKey).not.toHaveBeenCalled()
  })
})

type TestLoader = {
  traceMiddleware?: (
    handler: (...args: never[]) => unknown,
    route: { route: string; method?: string }
  ) => (...args: never[]) => unknown
}

describe("installConnectStoreCorsHook", () => {
  const storeCors = Object.defineProperty(
    jest.fn(),
    "name",
    { value: "corsMiddleware" }
  )

  it("identifies only Medusa's /store CORS middleware", () => {
    expect(isMedusaStoreCors(storeCors, { route: "/store" })).toBe(true)
    expect(isMedusaStoreCors(storeCors, { route: "/admin" })).toBe(false)
    expect(isMedusaStoreCors(storeCors, { route: "/store", method: "GET" })).toBe(false)
    expect(isMedusaStoreCors(function other() {}, { route: "/store" })).toBe(false)
  })

  it("wraps the store CORS middleware, passes others through, and chains a prior tracer", () => {
    const tracer = jest.fn((h: (...args: never[]) => unknown) => h)
    const loader: TestLoader = { traceMiddleware: tracer }
    installConnectStoreCorsHook(loader as never)

    const other = function ensurePublishableApiKeyMiddleware() {}
    expect(loader.traceMiddleware!(other, { route: "/store" })).toBe(other)

    const wrapped = loader.traceMiddleware!(storeCors, { route: "/store" })
    expect(wrapped).not.toBe(storeCors)
    expect(wrapped.name).toBe("connectAwareStoreCors")
    expect(tracer).toHaveBeenCalledTimes(2)
  })

  it("is idempotent", () => {
    const loader: TestLoader = {}
    installConnectStoreCorsHook(loader as never)
    const first = loader.traceMiddleware
    installConnectStoreCorsHook(loader as never)
    expect(loader.traceMiddleware).toBe(first)
  })
})
