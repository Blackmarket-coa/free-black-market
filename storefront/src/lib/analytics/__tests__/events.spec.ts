import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from "@/lib/logger"
import { emitWebsiteEvent } from "../events"

/**
 * Minimal browser globals: enough for `emitWebsiteEvent` to reach the
 * data layer, the DOM event and the backend request. `document.cookie`
 * carries the consent state under test.
 */
const stubBrowser = (cookie: string) => {
  const dataLayer: Record<string, unknown>[] = []
  const dispatchEvent = vi.fn()
  const sendBeacon = vi.fn(() => true)
  const fetch = vi.fn(() =>
    Promise.resolve(new Response(null, { status: 204 }))
  )

  vi.stubGlobal("window", {
    dataLayer,
    dispatchEvent,
    matchMedia: () => ({ matches: false }),
    location: { pathname: "/us/products/x", search: "?utm_source=tiktok" },
  })
  vi.stubGlobal("document", {
    cookie,
    referrer: "",
    querySelector: () => null,
  })
  vi.stubGlobal("navigator", { sendBeacon })
  vi.stubGlobal("fetch", fetch)
  vi.stubGlobal(
    "CustomEvent",
    class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    }
  )

  return { dataLayer, dispatchEvent, sendBeacon, fetch }
}

const BACKEND_URL = "http://backend.test"
const PUBLISHABLE_KEY = "pk_test_publishable"

describe("emitWebsiteEvent consent gating", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Trailing slash on purpose: the URL must still join cleanly.
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL", `${BACKEND_URL}/`)
    vi.stubEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", PUBLISHABLE_KEY)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("dispatches nothing when no consent choice is stored", () => {
    const b = stubBrowser("_medusa_cache_id=abc; _fbm_visitor=v-1")

    emitWebsiteEvent("product_view", { product_id: "prod_1" })
    emitWebsiteEvent("homepage_search_submitted")

    expect(b.dataLayer).toEqual([])
    expect(b.dispatchEvent).not.toHaveBeenCalled()
    expect(b.sendBeacon).not.toHaveBeenCalled()
    expect(b.fetch).not.toHaveBeenCalled()
  })

  it("dispatches nothing when the visitor chose essential cookies only", () => {
    const b = stubBrowser("fbm_consent=essential; _fbm_visitor=v-1")

    emitWebsiteEvent("purchase", { order_id: "order_1" })

    expect(b.dataLayer).toEqual([])
    expect(b.dispatchEvent).not.toHaveBeenCalled()
    expect(b.sendBeacon).not.toHaveBeenCalled()
    expect(b.fetch).not.toHaveBeenCalled()
  })

  it("dispatches to the data layer, DOM and backend once accepted", () => {
    const b = stubBrowser("fbm_consent=accepted; _fbm_visitor=v-1")

    emitWebsiteEvent("product_view", { product_id: "prod_1" })

    expect(b.dataLayer).toHaveLength(1)
    expect(b.dataLayer[0]).toMatchObject({
      event: "product_view",
      product_id: "prod_1",
      visitor_token: "v-1",
      utm_source: "tiktok",
    })
    expect(b.dispatchEvent).toHaveBeenCalledTimes(1)
    expect(b.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = b.fetch.mock.calls[0] as unknown as [
      string,
      RequestInit & { keepalive: boolean; headers: Record<string, string> },
    ]
    expect(url).toBe(`${BACKEND_URL}/store/analytics/events`)
    expect(init.method).toBe("POST")
    expect(init.keepalive).toBe(true)
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "x-publishable-api-key": PUBLISHABLE_KEY,
    })
    expect(JSON.parse(init.body as string)).toMatchObject({
      event_name: "product_view",
      visitor_token: "v-1",
      product_id: "prod_1",
    })
  })

  it("never uses sendBeacon: it cannot carry the publishable key", () => {
    const b = stubBrowser("fbm_consent=accepted")

    emitWebsiteEvent("product_view", { product_id: "prod_1" })

    expect(b.sendBeacon).not.toHaveBeenCalled()
    expect(b.fetch).toHaveBeenCalledTimes(1)
  })

  it("posts to the backend origin, never to the storefront's own /store path", () => {
    const b = stubBrowser("fbm_consent=accepted")

    emitWebsiteEvent("purchase", { order_id: "order_1" })

    const [url] = b.fetch.mock.calls[0] as unknown as [string]
    expect(url.startsWith(`${BACKEND_URL}/`)).toBe(true)
    expect(url).not.toBe("/store/analytics/events")
  })

  it.each([
    ["NEXT_PUBLIC_MEDUSA_BACKEND_URL"],
    ["NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY"],
  ])("skips the backend post when %s is unset", (name) => {
    vi.stubEnv(name, "")
    const b = stubBrowser("fbm_consent=accepted")

    emitWebsiteEvent("product_view", { product_id: "prod_1" })

    // The data layer still gets the event; only the request is skipped.
    expect(b.dataLayer).toHaveLength(1)
    expect(b.fetch).not.toHaveBeenCalled()
    expect(b.sendBeacon).not.toHaveBeenCalled()
  })

  it("keeps the visitor and referral identifiers out of the dev log", () => {
    const b = stubBrowser(
      "fbm_consent=accepted; _fbm_visitor=visitor-1.sig; _fbm_aff=ref-1.123"
    )

    emitWebsiteEvent("product_view", { product_id: "prod_1" })

    // The identifiers still reach the data layer; only the console omits them.
    expect(b.dataLayer[0]).toMatchObject({ visitor_token: "visitor-1" })
    const logged = vi.mocked(logger.info).mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >
    expect(logged).toMatchObject({ event: "product_view" })
    expect(logged).not.toHaveProperty("visitor_token")
    expect(logged).not.toHaveProperty("affiliate_short_code")
  })

  it("keeps marketing events off the backend even with consent", () => {
    const b = stubBrowser("fbm_consent=accepted")

    emitWebsiteEvent("homepage_search_submitted", { query_length: 3 })

    expect(b.dataLayer).toHaveLength(1)
    expect(b.sendBeacon).not.toHaveBeenCalled()
    expect(b.fetch).not.toHaveBeenCalled()
  })
})
