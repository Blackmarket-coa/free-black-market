/**
 * bargain-hunter.spec.ts — Surfaces persona #1.
 *
 * GOAL: home → listing → sort/filter by price → cheapest in-stock PDP →
 *       add one unit → cart → checkout, entirely AS A GUEST.
 *
 * DOM-ONLY, non-negotiable: this persona touches the app through
 * `page`/`browser` ONLY. It imports the fixture + base class from `../lib/persona`
 * (never "@playwright/test"), the resilient selectors from `../lib/selectors`, and
 * the pure oracle from `../lib/oracle`. It NEVER imports `../lib/differential` and
 * NEVER uses Playwright's `request` context — being unable to cheat via the API is
 * the entire point. The only `@playwright/test` import here is a TYPE-ONLY one
 * (`Page`/`Locator`), which carries no runtime and cannot reach the network.
 *
 * On the CURRENT stack this persona demonstrates, HONESTLY, how far the guest
 * funnel actually gets before it is blocked. It runs with
 * `stopOnOracleViolation: false` so one run walks as far as the DOM allows and
 * emits every lead it genuinely reaches, rather than halting at the first 5xx:
 *   • /us/store vs EUR-only region routing     → region-404 (major)  — listing route
 *   • every-PDP 500 (RangeError invalid time)  → reachability blocker (auto, per PDP)
 *   • funnel-blocked-before-cart               → blocker: because EVERY product page
 *     500s, add-to-cart is never reachable via the UI, so checkout/cart cannot be
 *     exercised at all from the storefront. We do NOT contrive reaching the cart.
 *
 * IMPORTANT (no overselling): the cart-500 / cart→checkout blockers below are only
 * emitted when a PDP actually renders an add-to-cart control and we truly reach the
 * cart. On today's all-PDP-500 stack that path is UNREACHABLE, so the honest
 * headline is region-404 + PDP-500 + funnel-blocked-before-cart — NOT a live
 * cart-creation-500 reproduction. The harness files nothing; the value is the
 * verdict doc it writes.
 */

import {
  test,
  expect,
  Persona,
  act,
  DONE,
  giveUp,
  type Action,
  type Percept,
  type PersonaMemory,
} from "../lib/persona"
import {
  productLinks,
  addToCartButton,
  goToCheckoutControl,
  readPdpPrice,
  readCartSnapshot,
} from "../lib/selectors"
import { parseMoney, type OracleResult, type CartSnapshot } from "../lib/oracle"
import type { Page } from "@playwright/test"

// The localized storefront segment this persona shops (/us default,
// EUR-only region → the region-fallback path is expected to trip). Kept in sync
// with the base-class `countryCode` option.
const COUNTRY = "us"
const HOME = `/${COUNTRY}`
const LISTING = `/${COUNTRY}/store`
const CART = `/${COUNTRY}/cart`
const MAX_PRODUCT_ATTEMPTS = 3

/** Typed view over the base class's free-form memory notes. */
interface Notes {
  sortApplied?: boolean
  sortWorked?: boolean
  triedStorePath?: boolean
  storeRegion404Logged?: boolean
  triedHrefs?: string[]
  expectedPrice?: number
  targetHref?: string
  productAttempts?: number
  addTried?: boolean
  pdpBroken?: boolean
  pdp500Count?: number
  pdpPrice?: number
  cartSnapshot?: CartSnapshot
  reachedCheckout?: boolean
}

// -------------------------------------------------------------------------
// Pure / DOM-only helpers (module scope keeps `decide` legible).
// -------------------------------------------------------------------------

function safePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
const isPdp = (path: string) => /\/products\//.test(path)
const isCart = (path: string) => /\/cart(\/|$|\?)/.test(path) || path.endsWith("/cart")
const isCheckout = (path: string) => /\/checkout/.test(path)

/** The lowest positive money token in a blob of card text (sale price wins). */
function cheapestMoneyIn(text: string): number | null {
  const toks = text.match(/[€$£]\s?-?\d[\d.,]*/g) || []
  let best: number | null = null
  for (const t of toks) {
    const n = parseMoney(t)
    if (n != null && n > 0 && (best == null || n < best)) best = n
  }
  return best
}

/**
 * Best-effort "sort listing by price, ascending" — the bargain-hunter's signature
 * move. Tries a native <select>, then a Sort trigger + option, then gives up
 * silently (the caller marks it applied either way so we never loop on a missing
 * control). Fully DOM-only; every interaction is short-timeout + swallowed.
 */
async function applyPriceSort(page: Page): Promise<boolean> {
  const asc = /price.*(asc|low|increasing)|low\s*(to|-)?\s*high|cheapest/i
  // Strategy 1 — a native <select> with a price-ascending option.
  const selects = page.locator("select")
  const nSel = await selects.count().catch(() => 0)
  for (let i = 0; i < nSel; i++) {
    const sel = selects.nth(i)
    const opts = await sel.locator("option").allInnerTexts().catch(() => [] as string[])
    const idx = opts.findIndex((o) => asc.test(o))
    if (idx >= 0) {
      await sel.selectOption({ index: idx }).catch(() => {})
      return true
    }
  }
  // Strategy 2 — a "Sort" trigger, then a price-ascending option/menuitem/link.
  const trigger = page
    .getByRole("button", { name: /sort/i })
    .or(page.getByRole("link", { name: /sort/i }))
    .first()
  if ((await trigger.count().catch(() => 0)) > 0) {
    await trigger.click({ timeout: 2000 }).catch(() => {})
    const opt = page
      .getByRole("option", { name: asc })
      .or(page.getByRole("menuitem", { name: asc }))
      .or(page.getByRole("link", { name: asc }))
      .first()
    if ((await opt.count().catch(() => 0)) > 0) {
      await opt.click({ timeout: 2000 }).catch(() => {})
      return true
    }
  }
  return false
}

/**
 * Read every product card on the listing, pick the cheapest in-stock one not yet
 * tried, remember its expected price, and return its href. DOM-only: one
 * page.evaluate over the product anchors, price parsing in JS.
 */
async function pickCheapest(page: Page, notes: Notes): Promise<string | null> {
  const tried = notes.triedHrefs ?? (notes.triedHrefs = [])
  const cards = await productLinks(page)
    .evaluateAll((els) => {
      const seen = new Set<string>()
      const out: { href: string; text: string }[] = []
      for (const el of els) {
        const a = el as HTMLAnchorElement
        const href = a.getAttribute("href") || ""
        if (!href || seen.has(href)) continue
        seen.add(href)
        const card = a.closest("li, article") || a.parentElement || a
        out.push({ href, text: (card as HTMLElement).innerText || a.innerText || "" })
      }
      return out
    })
    .catch(() => [] as { href: string; text: string }[])

  const scored = cards
    .map((c) => ({
      href: c.href,
      price: cheapestMoneyIn(c.text),
      inStock: !/out of stock|sold out|unavailable/i.test(c.text),
    }))
    .filter((c) => !tried.includes(c.href))
  if (!scored.length) return null

  const priced = scored.filter((c) => c.price != null)
  const pool = priced.filter((c) => c.inStock).length
    ? priced.filter((c) => c.inStock)
    : priced.length
      ? priced
      : scored
  pool.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))

  const chosen = pool[0]
  tried.push(chosen.href)
  notes.expectedPrice = chosen.price ?? undefined
  notes.targetHref = chosen.href
  notes.productAttempts = (notes.productAttempts ?? 0) + 1
  return chosen.href
}

// -------------------------------------------------------------------------
// The persona.
// -------------------------------------------------------------------------

class BargainHunter extends Persona {
  readonly name = "bargain-hunter"
  readonly goal =
    "guest sorts the listing by price and buys the cheapest in-stock item, via the DOM only"

  private notes(): Notes {
    return this.memory.notes as Notes
  }

  async decide(p: Percept, _m: PersonaMemory): Promise<Action> {
    const notes = this.notes()
    const path = safePath(p.url)

    // 0. Not on the storefront yet (about:blank on first tick) → land on home.
    if (!/^https?:/i.test(p.url)) {
      return act("open storefront home (/us)", async (page) => {
        await page.goto(HOME)
      })
    }

    // 1. Checkout reached → goal met (guest can reach checkout).
    if (isCheckout(path)) {
      notes.reachedCheckout = true
      this.verdict.verifiedClean(
        "cart→checkout reachable",
        "checkout page rendered for a guest — the full funnel is walkable"
      )
      return DONE
    }

    // 2. On the cart → resolve/probe the cart → checkout hand-off.
    if (isCart(path)) return this.decideOnCart(p)

    // 3. On a PDP → try to add the cheapest in-stock unit.
    if (isPdp(path)) return this.decideOnPdp(p)

    // 4. Otherwise treat it as a listing/home page.
    return this.decideOnListing(p)
  }

  /**
   * Listing/home: shop the catalog listing, then sort by price and open the
   * cheapest. The bargain hunter's canonical destination is /us/store, but under
   * the EUR-only seeded region that route 404s — so on a 404/zero-links store
   * listing we LOG region-404 (a lead) and FALL BACK to the product links the
   * /us home page does render, so the hunt still reaches a PDP.
   */
  private async decideOnListing(p: Percept): Promise<Action> {
    const notes = this.notes()
    const path = safePath(p.url)
    const onStore = /\/store(\/|$|\?)/.test(path)
    const nLinks = await productLinks(this.page).count().catch(() => 0)

    // 1. A bargain hunter heads for the catalog listing (/us/store) first — that
    //    is where a price sort lives. Visit it once from home before anything else.
    if (!notes.triedStorePath && !onStore) {
      notes.triedStorePath = true
      return act("navigate to product listing (/us/store)", async (page) => {
        await page.goto(LISTING)
      })
    }

    // 2. On /us/store but it 404'd / rendered zero products → region-404. Log it
    //    ONCE as a major lead, then fall back to the product links the /us home
    //    page DOES render, so the funnel still reaches a PDP (and the cart-500)
    //    rather than dead-ending on the broken listing route.
    if (onStore && nLinks === 0) {
      if (!notes.storeRegion404Logged) {
        notes.storeRegion404Logged = true
        const status = this.lastDocStatus
        this.verdict.divergence({
          source: "reachability",
          location: p.url,
          failureScenario:
            `the catalog listing ${LISTING} rendered no products` +
            (status ? ` [HTTP ${status}]` : "") +
            ` — under the EUR-only seeded region the /${COUNTRY}/store route does not resolve ` +
            `(region-404); the bargain hunter falls back to the /${COUNTRY} home product links`,
          severity: "major",
          invariant: "region-404",
          fix:
            `seed a region for /${COUNTRY} (or route the storefront to the seeded EUR region) so ` +
            `/${COUNTRY}/store resolves instead of 404ing`,
          evidence: { status, listing: LISTING, home: HOME },
        })
      }
      return act("fall back to the home product links (/us)", async (page) => {
        await page.goto(HOME)
      })
    }

    // 3. No product links anywhere we looked (neither /us/store nor /us home).
    if (nLinks === 0) {
      this.verdict.divergence({
        source: "persona",
        location: p.url,
        failureScenario:
          "No product links found on the /us/store listing OR the /us home page — " +
          "a bargain-hunter has no catalog to shop.",
        severity: "major",
        invariant: "catalog-nonempty",
        fix: "Verify region/publishable-key wiring so the seeded catalog renders on the storefront.",
        evidence: { url: p.url },
      })
      return giveUp("no products on any listing")
    }

    this.verdict.verifiedClean("storefront-listing", "product listing rendered with product links")

    // One-time price sort (marked applied regardless so a missing control never loops).
    if (!notes.sortApplied) {
      notes.sortApplied = true
      return act("sort listing by price ascending (bargain-first)", async (page) => {
        notes.sortWorked = await applyPriceSort(page)
      })
    }

    // Bail out of the hunt if we've burned our product-attempt budget.
    if ((notes.productAttempts ?? 0) >= MAX_PRODUCT_ATTEMPTS) {
      this.verdict.note(
        `Tried ${MAX_PRODUCT_ATTEMPTS} products without a buyable in-stock PDP; probing cart→checkout reachability.`
      )
      return act("probe cart→checkout after exhausting product attempts", async (page) => {
        await page.goto(CART)
      })
    }

    // Open the cheapest in-stock product (click the real card; goto fallback).
    return act("open cheapest in-stock product", async (page) => {
      const href = await pickCheapest(page, this.notes())
      if (!href) return
      const anchor = page.locator(`a[href="${href}"]`).first()
      try {
        await anchor.click({ timeout: 5000 })
      } catch {
        await page.goto(href).catch(() => {})
      }
    })
  }

  /** PDP: capture price, add one unit if buyable, else route onward honestly. */
  private async decideOnPdp(p: Percept): Promise<Action> {
    const notes = this.notes()

    // every-PDP 500 (RangeError invalid time). The 5xx blocker for THIS page is
    // auto-logged by observe(); we cannot add to cart here. We do NOT contrive
    // reaching the cart (add-to-cart is genuinely unreachable). Instead we try the
    // next-cheapest product to establish honestly that EVERY PDP 500s, and once the
    // attempt budget is spent we emit a single funnel-blocked-before-cart lead and
    // STOP — the honest framing (not a fabricated cart-500 reproduction).
    if (p.hasServerError) {
      notes.pdpBroken = true
      const n500 = (notes.pdp500Count = (notes.pdp500Count ?? 0) + 1)
      if ((notes.productAttempts ?? 0) < MAX_PRODUCT_ATTEMPTS) {
        this.verdict.note(
          `PDP returned a server error at ${p.url} (500 #${n500}); trying the next-cheapest product ` +
            `to confirm whether every PDP 500s.`
        )
        return act("back to the home listing after a 500 PDP", async (page) => {
          await page.goto(HOME)
        })
      }
      // Budget spent: every product page we could reach returned 500. The DOM
      // shopping funnel is blocked AT THE PDP — add-to-cart and checkout are simply
      // unreachable via the UI. This is the honest terminal lead.
      this.verdict.divergence({
        source: "persona",
        location: p.url,
        failureScenario:
          `every product page attempted (${n500} of ${notes.productAttempts ?? n500}) returned HTTP 500 ` +
          `(RangeError: invalid time) — the DOM shopping funnel is BLOCKED AT THE PDP: a guest cannot ` +
          `reach add-to-cart, the cart, or checkout via the storefront UI. (This is distinct from a ` +
          `cart-creation 500 — add-to-cart is never even reachable here, so the cart is not exercised.)`,
        severity: "blocker",
        invariant: "funnel-blocked",
        fix:
          "Fix the every-PDP 500 (RangeError: invalid time) so product pages render; the " +
          "add-to-cart → cart → checkout funnel only becomes reachable/testable once PDPs load.",
        evidence: { pdp500Count: n500, productAttempts: notes.productAttempts ?? null, listing: LISTING, home: HOME },
      })
      return giveUp("every PDP returns 500 — funnel blocked before add-to-cart")
    }

    // Capture the PDP price for the funnel price-consistency oracle.
    const price = await readPdpPrice(this.page).catch(() => null)
    if (price != null) notes.pdpPrice = price

    // /us default vs EUR-only region → "NOT AVAILABLE IN YOUR REGION" (auto major).
    if (p.notAvailableInRegion) {
      this.verdict.note(
        `PDP not available in region at ${p.url} — storefront routed to /${COUNTRY} with an EUR-only region.`
      )
      return act("probe cart→checkout (region-locked PDP)", async (page) => {
        await page.goto(CART)
      })
    }

    // Product-specific out-of-stock → try the next cheapest, if budget remains.
    if (p.outOfStock && (notes.productAttempts ?? 0) < MAX_PRODUCT_ATTEMPTS) {
      this.verdict.note(`PDP out of stock at ${p.url}; returning to listing for the next cheapest.`)
      return act("back to listing for next cheapest", async (page) => {
        await page.goto(LISTING)
      })
    }

    // Buyable → add exactly one unit (this fires POST /store/carts → trips BUG-01).
    if (p.addToCart.present && p.addToCart.enabled && !notes.addTried) {
      notes.addTried = true
      return act("add one unit to cart", async (page) => {
        await addToCartButton(page).click().catch(() => {})
      })
    }

    // Added (or can't add) → go read the cart.
    if (notes.addTried) {
      this.verdict.verifiedClean(
        "pdp-add-to-cart",
        "Add-to-Cart control clicked for an in-stock product"
      )
      return act("go to cart", async (page) => {
        await page.goto(CART)
      })
    }
    return act("go to cart (no usable add-to-cart)", async (page) => {
      await page.goto(CART)
    })
  }

  /** Cart: proceed to checkout if reachable, else emit the stuck-report(s). */
  private async decideOnCart(p: Percept): Promise<Action> {
    const notes = this.notes()
    const checkout = goToCheckoutControl(this.page)
    const hasCheckout = (await checkout.count().catch(() => 0)) > 0
    const cartProductCount = await productLinks(this.page).count().catch(() => 0)
    const snap = notes.cartSnapshot
    const total = snap?.total ?? 0
    const empty =
      (cartProductCount === 0 && !total) ||
      /cart is empty|bag is empty|no items in|your (shopping )?cart is empty/i.test(p.bodyText)

    // Happy path (future, once bugs clear): a non-empty cart exposes checkout.
    if (hasCheckout && !empty) {
      this.verdict.verifiedClean(
        "cart-has-checkout-affordance",
        "Go-to-checkout control present on a non-empty cart"
      )
      return act("proceed to checkout as guest", async (page) => {
        await goToCheckoutControl(page).click().catch(() => {})
      })
    }

    // BUG-01: we added a unit but the cart is empty → the POST /store/carts (or
    // line-add) did not persist. Distinct, higher-signal stuck-report.
    if (notes.addTried && empty) {
      this.verdict.divergence({
        source: "persona",
        location: this.page.url(),
        failureScenario:
          "Added one in-stock unit on the PDP, but the cart is empty — the add-to-cart POST /store/carts " +
          "did not persist a line (BUG-01: cart-creation 500). The guest cannot proceed to checkout.",
        severity: "blocker",
        invariant: "add-to-cart-persists",
        fix: "Fix the cart-creation 500 (BUG-01) so POST /store/carts succeeds and the line persists.",
        evidence: { cartUrl: this.page.url(), cartProductCount, total, sortWorked: notes.sortWorked },
      })
    }

    // Unreachable checkout: the conditionally-rendered cart→checkout link never
    // renders → a guest has no DOM path from cart to checkout.
    this.verdict.divergence({
      source: "persona",
      location: this.page.url(),
      failureScenario: empty
        ? "Cart→checkout is unreachable: the cart is empty, so the conditionally-rendered 'Go to checkout' " +
          "link never renders — a guest has no DOM path from cart to checkout."
        : "Cart shows items but exposes no working 'Go to checkout' affordance — the cart→checkout DOM path " +
          "is broken (unreachable checkout).",
      severity: "blocker",
      invariant: "checkout-reachable-from-cart",
      fix: "Always render a reachable checkout entry point (href=/checkout?step=address) whenever a guest has a cart.",
      evidence: { cartUrl: this.page.url(), hasCheckout, empty, cartProductCount, total },
    })
    return giveUp("cart→checkout unreachable")
  }

  /**
   * Per-step oracle checks (base loop logs any `fail` automatically). PDP price is
   * captured for the funnel oracle; cart snapshots feed the Tier-1 money oracles.
   * Passing checks are recorded as verified-clean so a green carries information;
   * only failures are returned (and thus logged) — skips are silent by design.
   */
  protected async checkInvariants(p: Percept): Promise<OracleResult[]> {
    const notes = this.notes()
    const path = safePath(p.url)
    const fails: OracleResult[] = []

    if (isCart(path)) {
      const snap = await readCartSnapshot(this.page).catch(() => null)
      if (snap) {
        notes.cartSnapshot = snap
        // Only compare a price when the cart is genuinely non-empty, so an empty
        // (BUG-01) cart is never mis-reported as a pricing divergence.
        const cartPrice = snap.itemsTotal ?? (snap.total > 0 ? snap.total : undefined)
        const checks: OracleResult[] = [
          this.oracle.cartTotalEqualsLineSum(snap),
          this.oracle.totalsReconcile(snap),
          this.oracle.priceConsistency({
            pdp: typeof notes.pdpPrice === "number" ? notes.pdpPrice : undefined,
            cart: cartPrice,
          }),
        ]
        for (const r of checks) {
          if (r.status === "pass") this.verdict.verifiedClean(`cart-oracle:${r.invariant}`, r.detail)
          else if (r.status === "fail") fails.push(r)
        }
      }
    }
    return fails
  }
}

test("bargain-hunter drives cheapest-first guest checkout through the DOM", async ({ agent }, testInfo) => {
  const persona = new BargainHunter(agent, {
    testInfo,
    options: {
      // Walk as far as the DOM allows and report every reachable lead in one run,
      // instead of halting at the first 5xx. This persona bounds ITSELF via
      // MAX_PRODUCT_ATTEMPTS (it retries a few PDPs to prove every-PDP-500, then
      // emits the funnel-blocked lead and gives up), so we hand it a generous
      // revisitLimit — the home↔PDP retry is INTENDED, not a runaway cycle — while
      // maxSteps stays the hard backstop. On the current all-PDP-500 stack it
      // finishes in ~9 short, timeout-bounded steps.
      stopOnOracleViolation: false,
      maxSteps: 16,
      stuckThreshold: 3,
      revisitLimit: 10,
      countryCode: COUNTRY,
    },
  })

  const result = await persona.run()
  // Surface the headline + every ranked lead in the Playwright report, and write
  // the verdict doc (the harness files nothing — the run's value is the doc).
  persona.verdict.annotate(testInfo)
  const verdictPath = persona.verdict.write(testInfo.outputDir)
  testInfo.annotations.push({ type: "verdict-doc", description: verdictPath })

  // The persona's value is the verdict doc, NOT test pass/fail — known downstream
  // blockers on the current stack are REPORTED, not asserted away, so a red here
  // means a genuine regression, not an expected-bug tautology. We assert only:
  //   (a) the harness itself didn't throw (a thrown decide/act = a real harness bug), and
  //   (b) the DOM funnel was actually walked (listing → PDP/cart), proving this
  //       wasn't a silent no-op.
  expect(result.persona).toBe("bargain-hunter")
  expect(result.stop).not.toBe("error")
  const walkedFunnel = result.memory.visited.some((u) => isPdp(u) || isCart(u))
  expect(walkedFunnel).toBe(true)
})
