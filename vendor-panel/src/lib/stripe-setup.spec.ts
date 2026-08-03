import { afterEach, describe, expect, it, vi } from "vitest"

import { mountCardSetup } from "./stripe-setup"

/**
 * The panel's vitest runs in the node environment (no jsdom dependency), so
 * these stub a minimal `window`/`document` rather than relying on a real DOM.
 * What matters is the contract: the load path degrades to `null` rather than
 * throwing — a card form that white-screens because a CDN was slow is worse
 * than one that says "unavailable" — and a decline surfaces as an error, not
 * an exception.
 */

const fakeCard = () => ({
  mount: vi.fn(),
  unmount: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
})

const stubWindow = (stripe: unknown) => {
  vi.stubGlobal("window", { Stripe: stripe })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("mountCardSetup", () => {
  it("returns null when Stripe.js never loaded (no global)", async () => {
    // No window.Stripe and a document whose injected script errors: the loader
    // must resolve null, not hang or throw.
    stubWindow(undefined)
    vi.stubGlobal("document", {
      querySelector: () => null,
      createElement: () => {
        const el: Record<string, unknown> = {}
        // Fire onerror once the loader has attached it.
        queueMicrotask(() => (el.onerror as (e: unknown) => void)?.(null))
        return el
      },
      head: { appendChild: (n: unknown) => n },
    })

    const mount = await mountCardSetup({
      publishableKey: "pk_test_1",
      clientSecret: "seti_1_secret",
      container: {} as HTMLElement,
    })
    expect(mount).toBeNull()
  })

  it("returns null when the publishable key is missing even if Stripe loads", async () => {
    stubWindow(() => ({}))
    const mount = await mountCardSetup({
      publishableKey: "",
      clientSecret: "seti_1_secret",
      container: {} as HTMLElement,
    })
    expect(mount).toBeNull()
  })

  it("returns null when the client secret is missing", async () => {
    stubWindow(() => ({}))
    const mount = await mountCardSetup({
      publishableKey: "pk_test_1",
      clientSecret: "",
      container: {} as HTMLElement,
    })
    expect(mount).toBeNull()
  })

  it("mounts a card and confirms a successful setup", async () => {
    const card = fakeCard()
    const confirmCardSetup = vi.fn(async () => ({
      setupIntent: { status: "succeeded", payment_method: "pm_1" },
    }))
    stubWindow(() => ({
      elements: () => ({ create: () => card }),
      confirmCardSetup,
    }))

    const mount = await mountCardSetup({
      publishableKey: "pk_test_1",
      clientSecret: "seti_1_secret",
      container: {} as HTMLElement,
    })
    expect(mount).not.toBeNull()
    expect(card.mount).toHaveBeenCalled()
    expect(await mount!.confirm()).toEqual({ ok: true })
  })

  it("surfaces a card decline as an error, not a throw", async () => {
    stubWindow(() => ({
      elements: () => ({ create: fakeCard }),
      confirmCardSetup: async () => ({
        error: { message: "Your card was declined." },
      }),
    }))

    const mount = await mountCardSetup({
      publishableKey: "pk_test_1",
      clientSecret: "seti_1_secret",
      container: {} as HTMLElement,
    })
    expect(await mount!.confirm()).toEqual({
      ok: false,
      error: "Your card was declined.",
    })
  })

  it("treats a non-succeeded setup intent as a retryable failure", async () => {
    stubWindow(() => ({
      elements: () => ({ create: fakeCard }),
      confirmCardSetup: async () => ({
        setupIntent: { status: "requires_action", payment_method: null },
      }),
    }))

    const mount = await mountCardSetup({
      publishableKey: "pk_test_1",
      clientSecret: "seti_1_secret",
      container: {} as HTMLElement,
    })
    const result = await mount!.confirm()
    expect(result.ok).toBe(false)
  })
})
