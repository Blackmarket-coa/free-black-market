import { readFileSync } from "fs"
import path from "path"
import vm from "vm"
import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * Coverage for the buyer-hub surface in `public/connect.js`.
 *
 * connect.js is a dependency-free IIFE served as a static asset, so it sits
 * outside the `src/**` build and has never had tests. It is also the one place
 * where buyer-supplied text is concatenated into `innerHTML`, which is worth
 * pinning down.
 *
 * Rather than restructure a shipped asset to make it importable, the file is
 * evaluated in a `vm` context with the smallest DOM stub that lets it load.
 * `document.readyState` is left as "loading" so the DOMContentLoaded auto-mount
 * never fires and only the explicitly-invoked functions run.
 */
function loadConnect(fetchImpl: unknown) {
  const source = readFileSync(
    path.join(__dirname, "../../../public/connect.js"),
    "utf8"
  )

  const scriptEl = {
    getAttribute: () => null,
    src: "https://cdn.example.test/connect.js",
  }

  const context: Record<string, unknown> = {
    fetch: fetchImpl,
    console: { warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  const documentStub = {
    currentScript: scriptEl,
    readyState: "loading",
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ setAttribute: () => {}, style: {}, appendChild: () => {} }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    getElementsByTagName: () => [scriptEl],
  }

  context.document = documentStub
  context.window = context
  context.self = context
  context.location = { href: "https://site.example.test/" }
  context.navigator = { userAgent: "test" }
  context.crypto = { getRandomValues: (a: Uint8Array) => a }

  vm.createContext(context)
  vm.runInContext(source, context)

  return (context as { FBM: any }).FBM
}

const jsonOk = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
})

describe("connect.js buyer-hub surface", () => {
  let calls: string[]

  beforeEach(() => {
    calls = []
  })

  const fetchSpy = (body: unknown) =>
    vi.fn(async (url: string) => {
      calls.push(url)
      return jsonOk(body)
    })

  it("exposes the buyer-hub surface on the public API", () => {
    const FBM = loadConnect(fetchSpy({ demand_pools: [] }))

    expect(typeof FBM.getDemandPools).toBe("function")
    expect(typeof FBM.renderDemandPools).toBe("function")
  })

  it("queries the public demand-pool endpoint without needing a vendor", async () => {
    const fetchImpl = fetchSpy({ demand_pools: [] })
    const FBM = loadConnect(fetchImpl)

    // No vendor is configured here at all. Every other surface would reject
    // with "no vendor configured"; the buyer hub is demand-side and must not.
    await FBM.getDemandPools()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("/store/collective/demand-pools")
    expect(calls[0]).toContain("limit=12")
  })

  it("passes category, region, bounty floor and sort through as filters", async () => {
    const FBM = loadConnect(fetchSpy({ demand_pools: [] }))

    await FBM.getDemandPools({
      category: "whole grain",
      region: "mid west",
      minBounty: 50,
      sort: "bounty",
      limit: 5,
    })

    expect(calls[0]).toContain("limit=5")
    // Values must be encoded — a space or & in a region would otherwise
    // corrupt the query string.
    expect(calls[0]).toContain("category=whole%20grain")
    expect(calls[0]).toContain("delivery_region=mid%20west")
    expect(calls[0]).toContain("min_bounty=50")
    expect(calls[0]).toContain("sort_by=bounty")
  })

  it("attaches a storefront URL to each pool", async () => {
    const FBM = loadConnect(fetchSpy({ demand_pools: [{ id: "dp_1", title: "Oats" }] }))

    const pools = await FBM.getDemandPools()

    expect(pools).toHaveLength(1)
    expect(pools[0]._url).toContain("/collective/demand-pools/dp_1")
  })

  it("encodes the pool id into the URL", async () => {
    const FBM = loadConnect(
      fetchSpy({ demand_pools: [{ id: "dp/../evil", title: "x" }] })
    )

    const pools = await FBM.getDemandPools()

    expect(pools[0]._url).toContain("dp%2F..%2Fevil")
    expect(pools[0]._url).not.toContain("dp/../evil")
  })

  it("tolerates a response with no demand_pools array", async () => {
    const FBM = loadConnect(fetchSpy({}))

    await expect(FBM.getDemandPools()).resolves.toEqual([])
  })

  it("rejects on a failed request rather than rendering junk", async () => {
    const FBM = loadConnect(
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    )

    await expect(FBM.getDemandPools()).rejects.toThrow(/503/)
  })

  describe("rendering", () => {
    // resolveEl accepts anything with a truthy nodeType, so a plain object
    // captures the HTML the widget would have written into the page.
    const fakeNode = () => ({ nodeType: 1, innerHTML: "" })

    it("escapes buyer-supplied text before it reaches innerHTML", async () => {
      const FBM = loadConnect(
        fetchSpy({
          demand_pools: [
            {
              id: "dp_1",
              title: '<img src=x onerror="alert(1)">',
              category: '"><script>alert(2)</script>',
              committed_quantity: 1,
              target_quantity: 2,
            },
          ],
        })
      )
      const node = fakeNode()

      await FBM.renderDemandPools(node)

      // Pool titles and categories are written by buyers, so this is the one
      // untrusted string in the surface. It must never survive as markup.
      expect(node.innerHTML).not.toContain("<img src=x")
      expect(node.innerHTML).not.toContain("<script>")
      expect(node.innerHTML).toContain("&lt;img src=x")
      expect(node.innerHTML).toContain("&lt;script&gt;")
    })

    it("renders a progress bar from committed vs target", async () => {
      const FBM = loadConnect(
        fetchSpy({
          demand_pools: [
            { id: "dp_1", title: "Oats", committed_quantity: 25, target_quantity: 100 },
          ],
        })
      )
      const node = fakeNode()

      await FBM.renderDemandPools(node)

      expect(node.innerHTML).toContain("width:25%")
      expect(node.innerHTML).toContain("25 of 100 units committed")
    })

    it("does not divide by zero when a pool has no target", async () => {
      const FBM = loadConnect(
        fetchSpy({
          demand_pools: [
            { id: "dp_1", title: "Oats", committed_quantity: 5, target_quantity: 0 },
          ],
        })
      )
      const node = fakeNode()

      await FBM.renderDemandPools(node)

      expect(node.innerHTML).toContain("width:0%")
      expect(node.innerHTML).not.toContain("NaN")
      expect(node.innerHTML).not.toContain("Infinity")
    })

    it("caps the bar at 100% when demand overshoots the target", async () => {
      const FBM = loadConnect(
        fetchSpy({
          demand_pools: [
            { id: "dp_1", title: "Oats", committed_quantity: 500, target_quantity: 100 },
          ],
        })
      )
      const node = fakeNode()

      await FBM.renderDemandPools(node)

      expect(node.innerHTML).toContain("width:100%")
    })

    it("shows an empty state rather than a blank block", async () => {
      const FBM = loadConnect(fetchSpy({ demand_pools: [] }))
      const node = fakeNode()

      await FBM.renderDemandPools(node)

      expect(node.innerHTML).toContain("No open requests right now.")
    })

    it("never implies fulfillment is guaranteed", async () => {
      const FBM = loadConnect(
        fetchSpy({
          demand_pools: [
            { id: "dp_1", title: "Oats", committed_quantity: 1, target_quantity: 2 },
          ],
        })
      )
      const node = fakeNode()

      await FBM.renderDemandPools(node)

      // A demand pool is a best-effort pledge backed by escrow, not a
      // guaranteed-delivery contract, and the copy must not suggest otherwise.
      expect(node.innerHTML).toContain("Join this request")
      expect(node.innerHTML).not.toMatch(/guarantee|reserved|secured/i)
    })

    it("degrades to a message when the request fails", async () => {
      const FBM = loadConnect(
        vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
      )
      const node = fakeNode()

      await FBM.renderDemandPools(node)

      expect(node.innerHTML).toContain("Unable to load right now.")
    })
  })

  it("never sends credentials", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.credentials).toBe("omit")
      return jsonOk({ demand_pools: [] })
    })
    const FBM = loadConnect(fetchImpl)

    await FBM.getDemandPools()
    expect(fetchImpl).toHaveBeenCalled()
  })
})
