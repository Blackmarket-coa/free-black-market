/**
 * differential.ts — READ-ONLY differential oracle. HARNESS-ONLY.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DO NOT IMPORT THIS FROM PERSONA / AGENT CODE.                            │
 * │  This is the one place the harness is allowed to use Playwright's         │
 * │  `request` context + the store publishable key to reconstruct "what the  │
 * │  backend says SHOULD have happened", then compare it to what the browser  │
 * │  showed. Personas stay API-blind; only the harness/oracle may peek.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A divergence flagged here is always `PLAUSIBLE` — a mechanism-sound mismatch,
 * NOT a confirmed bug. Promotion to CONFIRMED is the adversarial verifier's job
 * (an independent skeptic re-repro against the live local stack). This composes
 * with, and never replaces, that step.
 *
 * READ-ONLY: only GET requests, only against the loopback backend. It never
 * POSTs, mutates, or completes a cart — that would both taint state and defeat
 * the DOM-only doctrine.
 *
 * GRACEFUL DEGRADATION: the API reconstruction needs a store publishable key.
 * No key is hardcoded (it comes only from `STORE_PUBLISHABLE_KEY`). When the key
 * is empty/absent, `create()` builds a DISABLED oracle: it opens no request
 * context, fires no request, logs a one-line skip note, and every
 * API-reconstruction method returns its empty/no-divergence value. Nothing
 * throws and no spec fails. DOM-only personas never use the key and are wholly
 * unaffected.
 */

import { request as playwrightRequest, type APIRequestContext } from "@playwright/test"
import { assertLoopback, storeContext, targets } from "./guard"
import { moneyEquals, parseMoney, type CartSnapshot } from "./oracle"
import type { Divergence } from "./verdict"

/** A trimmed store-product view reconstructed from the API. */
export interface StoreProductLite {
  id: string
  title: string
  handle: string
  /** Cheapest variant calculated price in major units, or null. */
  cheapestPrice: number | null
}

export interface DifferentialConfig {
  backendUrl: string
  publishableKey: string
  regionId: string
}

export class DifferentialOracle {
  private constructor(
    private readonly ctx: APIRequestContext | null,
    private readonly cfg: DifferentialConfig,
    private readonly enabled: boolean
  ) {}

  /**
   * True when a publishable key is configured and the read-only API oracle is
   * live. False when the oracle degraded to a skip (no `STORE_PUBLISHABLE_KEY`);
   * callers may branch on this, but every method already self-skips when false.
   */
  get isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Build a differential oracle. Fails closed if the backend is off-loopback.
   * Env overrides: BACKEND_URL, STORE_PUBLISHABLE_KEY, STORE_REGION_ID.
   *
   * With no publishable key there is nothing to reconstruct against, so the
   * oracle degrades to a skip: no request context is opened, a one-line note is
   * logged, and the API-reconstruction methods become no-ops (see class doc).
   */
  static async create(overrides: Partial<DifferentialConfig> = {}): Promise<DifferentialOracle> {
    const store = storeContext()
    const cfg: DifferentialConfig = {
      backendUrl: overrides.backendUrl ?? targets().backend,
      publishableKey: overrides.publishableKey ?? store.publishableKey,
      regionId: overrides.regionId ?? store.regionId,
    }
    // The loopback guard is about where we are ALLOWED to point, so it still
    // applies to the configured backend even when we will not fire a request.
    assertLoopback(cfg.backendUrl, "BACKEND_URL (differential oracle)")

    if (!cfg.publishableKey) {
      // eslint-disable-next-line no-console
      console.info(
        "[agents:differential] differential oracle skipped: set " +
          "STORE_PUBLISHABLE_KEY (and STORE_REGION_ID) to enable read-only " +
          "browser/API reconciliation. DOM-only personas are unaffected."
      )
      return new DifferentialOracle(null, cfg, false)
    }

    const ctx = await playwrightRequest.newContext({
      baseURL: cfg.backendUrl,
      extraHTTPHeaders: { "x-publishable-api-key": cfg.publishableKey },
    })
    return new DifferentialOracle(ctx, cfg, true)
  }

  /** List published products with their cheapest calculated price (region-scoped). */
  async listProducts(): Promise<StoreProductLite[]> {
    if (!this.enabled || !this.ctx) return []
    const res = await this.ctx.get(
      `/store/products?limit=100&region_id=${encodeURIComponent(this.cfg.regionId)}&fields=*variants.calculated_price`
    )
    if (!res.ok()) return []
    const body = (await res.json().catch(() => ({}))) as { products?: unknown[] }
    const products = Array.isArray(body.products) ? body.products : []
    return products.map((p) => this.toLite(p as Record<string, unknown>))
  }

  /** Expected cheapest price for a product handle (major units), or null. */
  async expectedPrice(handle: string): Promise<number | null> {
    if (!this.enabled || !this.ctx) return null
    const res = await this.ctx.get(
      `/store/products?handle=${encodeURIComponent(handle)}&region_id=${encodeURIComponent(
        this.cfg.regionId
      )}&fields=*variants.calculated_price`
    )
    if (!res.ok()) return null
    const body = (await res.json().catch(() => ({}))) as { products?: unknown[] }
    const first = Array.isArray(body.products) ? body.products[0] : undefined
    if (!first) return null
    return this.toLite(first as Record<string, unknown>).cheapestPrice
  }

  /**
   * Compare a browser-observed unit price for `handle` against the API price.
   * Returns a PLAUSIBLE divergence on mismatch, or null when they agree / the
   * API had no price to compare.
   */
  async reconcilePrice(handle: string, observed: number): Promise<Divergence | null> {
    if (!this.enabled) return null
    const expected = await this.expectedPrice(handle)
    if (expected == null) return null
    if (moneyEquals(expected, observed)) return null
    return {
      source: "differential",
      verdict: "PLAUSIBLE",
      severity: "major",
      invariant: "browser-price==api-price",
      location: `/products/${handle}`,
      failureScenario:
        `browser showed unit price ${observed} for "${handle}" but the store API ` +
        `(region ${this.cfg.regionId}) reconstructs ${expected} — browser/API divergence`,
      evidence: { handle, observed, expected, regionId: this.cfg.regionId },
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Reconcile a browser CartSnapshot's grand total against a caller-supplied
   * expected total (e.g. Σ API prices × quantities the harness tracked). Flags
   * a PLAUSIBLE divergence on mismatch. The harness supplies `expectedTotal`
   * because the API-blind persona never exposes its server-side cart id.
   */
  reconcileCartTotal(cart: CartSnapshot, expectedTotal: number): Divergence | null {
    if (moneyEquals(cart.total, expectedTotal)) return null
    return {
      source: "differential",
      verdict: "PLAUSIBLE",
      severity: "major",
      invariant: "browser-total==api-total",
      location: "/cart",
      failureScenario:
        `browser cart total ${cart.total} ${cart.currency} diverges from the API ` +
        `reconstruction ${expectedTotal}`,
      evidence: { browserTotal: cart.total, expectedTotal, currency: cart.currency },
      timestamp: new Date().toISOString(),
    }
  }

  async dispose(): Promise<void> {
    if (this.ctx) await this.ctx.dispose()
  }

  private toLite(p: Record<string, unknown>): StoreProductLite {
    const variants = Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[]) : []
    const prices: number[] = []
    for (const v of variants) {
      const cp = v.calculated_price as Record<string, unknown> | undefined
      const amt = cp?.calculated_amount
      const n = typeof amt === "number" ? amt : parseMoney(String(amt ?? ""))
      if (n != null && Number.isFinite(n)) prices.push(n)
    }
    return {
      id: String(p.id ?? ""),
      title: String(p.title ?? ""),
      handle: String(p.handle ?? ""),
      cheapestPrice: prices.length ? Math.min(...prices) : null,
    }
  }
}
