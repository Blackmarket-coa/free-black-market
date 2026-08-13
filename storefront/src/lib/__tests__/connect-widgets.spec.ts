import { readFileSync } from "fs"
import path from "path"
import vm from "vm"
import { describe, it, expect, vi } from "vitest"

/**
 * Widget coverage for `public/connect.js`, extending the harness proven in
 * connect-demand-pools.spec.ts. Every widget concatenates API-supplied text
 * into `innerHTML`, so beyond render/empty/error behavior, each renderer gets
 * an escaping case: a hostile string from the API must come out entity-encoded,
 * never as markup.
 *
 * Same loading strategy as the sibling spec: the shipped IIFE is evaluated in
 * a `vm` context with the smallest DOM stub that lets it load, with
 * `document.readyState` left as "loading" so auto-mount never fires.
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

/** The smallest thing resolveEl() accepts as a render target. */
const fakeNode = () => ({ nodeType: 1, innerHTML: "" })

const XSS = '<img src=x onerror="alert(1)">'
const XSS_ESCAPED = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"

describe("connect.js widget surface", () => {
  it("renders a product grid and escapes hostile titles", async () => {
    const FBM = loadConnect(
      vi.fn(async () =>
        jsonOk({
          vendor: { name: "Test Vendor" },
          products: [
            { id: "p1", title: XSS, type: "physical" },
            { id: "p2", title: "Honest Soap", type: "physical" },
          ],
        })
      )
    )
    FBM.configure({ vendor: "test-vendor" })

    const node = fakeNode()
    await FBM.renderProducts(node)

    expect(node.innerHTML).toContain("fbm-grid")
    expect(node.innerHTML).toContain("Honest Soap")
    expect(node.innerHTML).toContain(XSS_ESCAPED)
    expect(node.innerHTML).not.toContain(XSS)
  })

  it("shows the empty state when a vendor has no products", async () => {
    const FBM = loadConnect(
      vi.fn(async () => jsonOk({ vendor: { name: "V" }, products: [] }))
    )
    FBM.configure({ vendor: "test-vendor" })

    const node = fakeNode()
    await FBM.renderProducts(node)

    expect(node.innerHTML).toContain("fbm-empty")
    expect(node.innerHTML).toContain("No products yet.")
  })

  it("fails soft when the API is unreachable", async () => {
    const FBM = loadConnect(vi.fn(async () => Promise.reject(new Error("down"))))
    FBM.configure({ vendor: "test-vendor" })

    const node = fakeNode()
    await FBM.renderProducts(node)

    expect(node.innerHTML).toContain("Unable to load right now.")
  })

  it("renders the vendor card with escaped name and description", async () => {
    const FBM = loadConnect(
      vi.fn(async () =>
        jsonOk({ vendor: { name: XSS, description: "Real & honest goods", verified: true } })
      )
    )
    FBM.configure({ vendor: "test-vendor" })

    const node = fakeNode()
    await FBM.renderVendor(node)

    expect(node.innerHTML).toContain("fbm-vendor")
    expect(node.innerHTML).toContain(XSS_ESCAPED)
    expect(node.innerHTML).not.toContain(XSS)
    expect(node.innerHTML).toContain("Real &amp; honest goods")
    expect(node.innerHTML).toContain("fbm-vendor__verified")
  })

  it("reports a missing vendor rather than rendering an empty card", async () => {
    const FBM = loadConnect(vi.fn(async () => jsonOk({ vendor: null })))
    FBM.configure({ vendor: "test-vendor" })

    const node = fakeNode()
    await FBM.renderVendor(node)

    expect(node.innerHTML).toContain("Vendor not found.")
  })

  it("renders reviews with summary, stars, and escaped bodies", async () => {
    const FBM = loadConnect(
      vi.fn(async () =>
        jsonOk({
          reviews: [
            { rating: 5, author: "A. Buyer", title: "Great", body: XSS, verified: true },
            { rating: 3, body: "Fine." },
          ],
          summary: { average: 4.2, count: 2 },
        })
      )
    )
    FBM.configure({ vendor: "test-vendor" })

    const node = fakeNode()
    await FBM.renderReviews(node)

    expect(node.innerHTML).toContain("fbm-stars")
    expect(node.innerHTML).toContain("4.2")
    expect(node.innerHTML).toContain("2 reviews")
    expect(node.innerHTML).toContain(XSS_ESCAPED)
    expect(node.innerHTML).not.toContain(XSS)
    // The anonymous fallback author renders for the second review.
    expect(node.innerHTML).toContain("Verified buyer")
  })

  it("shows the review empty state", async () => {
    const FBM = loadConnect(
      vi.fn(async () => jsonOk({ reviews: [], summary: {} }))
    )
    FBM.configure({ vendor: "test-vendor" })

    const node = fakeNode()
    await FBM.renderReviews(node)

    expect(node.innerHTML).toContain("No reviews yet.")
  })

  it("resolves render targets defensively: null for unknown selectors, no crash", async () => {
    const FBM = loadConnect(vi.fn(async () => jsonOk({})))
    FBM.configure({ vendor: "test-vendor" })

    // String selector resolves through the stubbed document.querySelector →
    // null; the renderer must return a resolved promise, not throw.
    await expect(FBM.renderProducts("#missing")).resolves.toBeUndefined()
  })

  it("exposes the declared release version", () => {
    const FBM = loadConnect(vi.fn(async () => jsonOk({})))
    expect(FBM.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
