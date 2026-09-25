import http from "http"
import os from "os"
import path from "path"
import fs from "fs"
import express from "express"
import { ApiLoader } from "@medusajs/framework/http"
import { configManager } from "@medusajs/framework/config"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { installConnectStoreCorsHook, resetConnectOriginCache } from "../connect-cors"
import { EMBED_KEYS_MODULE } from "../../../modules/embed-keys"

/**
 * End-to-end check of the connect.js gate against the REAL Medusa ApiLoader:
 * its /store CORS middleware, its ensurePublishableApiKeyMiddleware and its
 * registration order, not stubs of them. Only the data layer (container
 * resolutions) is faked, and the routes are tiny JS files standing in for the
 * real handlers. If a Medusa upgrade renames or reorders the store CORS
 * middleware so the hook no longer attaches, these fail — connect.js would be
 * broken on vendor sites again.
 */

const VENDOR_ORIGIN = "https://www.shop.example.com"
const UNREGISTERED_ORIGIN = "https://evil.example.net"
const FIRST_PARTY_ORIGIN = "https://freeblackmarket.com"
const PLATFORM_PK = "pk_platform_storefront"
const GOOD_KEY = "pk_live_good"
const REVOKED_KEY = "pk_live_revoked"

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
  http: () => {},
  shouldLog: () => false,
}

const query = {
  graph: jest.fn(
    async (args: {
      entity: string
      filters?: { token?: string; seller_id?: string }
    }) => {
      if (args.entity === "api_key") {
        return args.filters?.token === PLATFORM_PK
          ? {
              data: [
                {
                  id: "apk_1",
                  token: PLATFORM_PK,
                  revoked_at: null,
                  sales_channels_link: [{ sales_channel_id: "sc_1" }],
                },
              ],
            }
          : { data: [] }
      }
      if (args.entity === "seller_metadata") {
        return { data: [{ connect_domains: ["shop.example.com"] }] }
      }
      return { data: [] }
    }
  ),
}

const embedKeys = {
  verifyKey: jest.fn(async (plaintext: string) =>
    plaintext === GOOD_KEY ? { id: "ek_1", seller_id: "sel_1" } : null
  ),
}

const scope = {
  resolve: (key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return query
    if (key === EMBED_KEYS_MODULE) return embedKeys
    if (key === ContainerRegistrationKeys.CONFIG_MODULE) return configManager.config
    if (key === ContainerRegistrationKeys.LOGGER) return logger
    return undefined
  },
}

const ROUTE_BODY = `
exports.GET = async (req, res) => res.json({ ok: true, sales_channel_ids: req.publishable_key_context ? req.publishable_key_context.sales_channel_ids : null })
exports.POST = exports.GET
`

let server: http.Server
let port: number
let tmpDir: string
const ORIGINAL_TRACE = ApiLoader.traceMiddleware
const ORIGINAL_ENV = process.env.FBM_CONNECT_PUBLISHABLE_KEY

beforeAll(async () => {
  process.env.FBM_CONNECT_PUBLISHABLE_KEY = PLATFORM_PK

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-cors-"))
  for (const dir of [
    "store/vendors/[handle]",
    "store/embed/bookings",
    "store/products",
  ]) {
    fs.mkdirSync(path.join(tmpDir, dir), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, dir, "route.js"), ROUTE_BODY)
  }

  configManager.loadConfig({
    projectConfig: {
      projectConfig: {
        redisUrl: "redis://unused",
        http: {
          storeCors: FIRST_PARTY_ORIGIN,
          adminCors: "",
          authCors: "",
          jwtSecret: "test",
          cookieSecret: "test",
        },
      },
    } as never,
    baseDir: tmpDir,
    throwOnError: false,
  })

  ApiLoader.traceMiddleware = undefined
  installConnectStoreCorsHook()

  const app = express()
  app.use((req, _res, next) => {
    ;(req as unknown as { scope: typeof scope }).scope = scope
    next()
  })
  await new ApiLoader({
    // backend resolves two @types/express majors; the runtime app is the same.
    app: app as never,
    sourceDir: tmpDir,
    container: scope as never,
  }).load()

  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  port = (server.address() as { port: number }).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  ApiLoader.traceMiddleware = ORIGINAL_TRACE
  if (ORIGINAL_ENV === undefined) delete process.env.FBM_CONNECT_PUBLISHABLE_KEY
  else process.env.FBM_CONNECT_PUBLISHABLE_KEY = ORIGINAL_ENV
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  resetConnectOriginCache()
})

type Result = { status: number; headers: http.IncomingHttpHeaders; body: string }

const send = (
  method: string,
  urlPath: string,
  headers: Record<string, string>,
  body?: string
): Promise<Result> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: urlPath, headers },
      (res) => {
        let data = ""
        res.on("data", (c) => (data += c))
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data })
        )
      }
    )
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })

const preflight = (urlPath: string, origin: string, method = "GET") =>
  send("OPTIONS", urlPath, {
    Origin: origin,
    "Access-Control-Request-Method": method,
    "Access-Control-Request-Headers": "authorization,content-type",
  })

const sdkHeaders = (origin: string, key = GOOD_KEY) => ({
  Origin: origin,
  Accept: "application/json",
  Authorization: `PublishableKey ${key}`,
})

describe("connect.js through the real Medusa ApiLoader", () => {
  it("answers the preflight from a registered vendor origin", async () => {
    const res = await preflight("/store/vendors/shop?currency_code=usd", VENDOR_ORIGIN)
    expect(res.status).toBe(204)
    expect(res.headers["access-control-allow-origin"]).toBe(VENDOR_ORIGIN)
    expect(String(res.headers["access-control-allow-headers"])).toMatch(/Authorization/)
  })

  it("serves the actual GET with the embed key alone", async () => {
    const res = await send("GET", "/store/vendors/shop?currency_code=usd", sdkHeaders(VENDOR_ORIGIN))
    expect(res.status).toBe(200)
    expect(res.headers["access-control-allow-origin"]).toBe(VENDOR_ORIGIN)
    // Medusa's own publishable-key middleware resolved the platform key.
    expect(JSON.parse(res.body)).toEqual({ ok: true, sales_channel_ids: ["sc_1"] })
  })

  it("serves an embed POST (preflight + actual) from a registered origin", async () => {
    const pre = await preflight("/store/embed/bookings", VENDOR_ORIGIN, "POST")
    expect(pre.status).toBe(204)
    expect(pre.headers["access-control-allow-origin"]).toBe(VENDOR_ORIGIN)

    const res = await send(
      "POST",
      "/store/embed/bookings",
      { ...sdkHeaders(VENDOR_ORIGIN), "Content-Type": "application/json" },
      JSON.stringify({ product_id: "p_1" })
    )
    expect(res.status).toBe(200)
    expect(res.headers["access-control-allow-origin"]).toBe(VENDOR_ORIGIN)
  })

  it("blocks an unregistered origin at preflight and on the actual request", async () => {
    const pre = await preflight("/store/vendors/shop", UNREGISTERED_ORIGIN)
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined()

    const res = await send("GET", "/store/vendors/shop", sdkHeaders(UNREGISTERED_ORIGIN))
    expect(res.status).toBe(400)
    expect(res.headers["access-control-allow-origin"]).toBeUndefined()
  })

  it("rejects a missing, invalid or revoked key exactly as before", async () => {
    const missing = await send("GET", "/store/vendors/shop", { Origin: VENDOR_ORIGIN })
    const invalid = await send("GET", "/store/vendors/shop", sdkHeaders(VENDOR_ORIGIN, "pk_live_nope"))
    const revoked = await send("GET", "/store/vendors/shop", sdkHeaders(VENDOR_ORIGIN, REVOKED_KEY))
    for (const res of [missing, invalid, revoked]) {
      expect(res.status).toBe(400)
      expect(res.body).toMatch(/Publishable API key required/)
      expect(res.headers["access-control-allow-origin"]).toBeUndefined()
    }
  })

  it("does not loosen other /store routes", async () => {
    const pre = await preflight("/store/products", VENDOR_ORIGIN)
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined()

    const res = await send("GET", "/store/products", sdkHeaders(VENDOR_ORIGIN))
    expect(res.status).toBe(400)
    expect(res.body).toMatch(/Publishable API key required/)
  })

  it("keeps Medusa's CORS answer for first-party origins", async () => {
    const pre = await preflight("/store/vendors/shop", FIRST_PARTY_ORIGIN)
    expect(pre.status).toBe(204)
    expect(pre.headers["access-control-allow-origin"]).toBe(FIRST_PARTY_ORIGIN)
    expect(pre.headers["access-control-allow-credentials"]).toBe("true")
  })
})
