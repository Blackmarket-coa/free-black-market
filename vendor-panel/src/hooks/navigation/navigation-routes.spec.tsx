import { matchRoutes, type RouteObject } from "react-router-dom"
import { afterAll, describe, expect, it, vi } from "vitest"

/**
 * SD-152 (8): the cottage-food dashboard was routed and missing from the
 * sidebar. This holds the other direction too: what the sidebar offers a
 * seller is a page the router serves.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)

import { getFeaturesForPlaybook } from "../../providers/vendor-type-provider"
import { RouteMap } from "../../providers/router-provider/route-map"
import { getVendorNavigationForTest } from "./use-vendor-navigation"

afterAll(() => browser.restore())

describe("every sidebar entry reaches a page", () => {
  it("for a seller with products, the cottage-food dashboard included", () => {
    const routes = RouteMap as RouteObject[]
    const noMatch = matchRoutes(routes, "/no-such-page")?.at(-1)?.route
    expect(noMatch?.path).toBe("*")

    const { coreRoutes, extensionRoutes } = getVendorNavigationForTest({
      vendorType: "maker",
      features: getFeaturesForPlaybook("stall"),
    })
    const targets = [...coreRoutes, ...extensionRoutes].flatMap((route) => [
      route.to,
      ...(route.items ?? []).map((item) => item.to),
    ])

    expect(targets).toContain("/cottage-food")
    expect(targets).toContain("/products")
    for (const target of targets) {
      const path = target.split("?")[0]
      expect(matchRoutes(routes, path)?.at(-1)?.route, target).not.toBe(noMatch)
    }
  })
})
