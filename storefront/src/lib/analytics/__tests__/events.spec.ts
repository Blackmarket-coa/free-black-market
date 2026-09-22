import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { emitWebsiteEvent } from "../events"

/**
 * Minimal browser globals: enough for `emitWebsiteEvent` to reach the
 * data layer, the DOM event and the backend beacon. `document.cookie`
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

describe("emitWebsiteEvent consent gating", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(b.sendBeacon).toHaveBeenCalledTimes(1)
    const [url] = b.sendBeacon.mock.calls[0] as unknown as [string]
    expect(url).toBe("/store/analytics/events")
  })

  it("keeps marketing events off the backend even with consent", () => {
    const b = stubBrowser("fbm_consent=accepted")

    emitWebsiteEvent("homepage_search_submitted", { query_length: 3 })

    expect(b.dataLayer).toHaveLength(1)
    expect(b.sendBeacon).not.toHaveBeenCalled()
    expect(b.fetch).not.toHaveBeenCalled()
  })
})
