/**
 * returning-buyer.spec.ts — Tier-1 persona #3.
 *
 * GOAL: register / log in through the UI, save a shipping address, complete a
 * checkout, then open /user/orders and assert the order appears with the correct
 * total. A REGISTERED buyer journey — the account + saved-address + order-history
 * surfaces that the guest personas never touch.
 *
 * DOM-ONLY, non-negotiable: this persona uses ONLY `page` / `browser` via
 * the `agent` fixture. It never imports `../lib/differential`, never touches
 * Playwright's `request` context, and never calls /store /admin /vendor directly.
 * Being unable to cheat via the API is the entire point — it has to find the
 * button, fill the form, and read the screen.
 *
 * It is written as REGRESSION GOLD: on a healthy stack the journey completes with
 * zero blocker-severity divergences (green). On today's stack it is EXPECTED red —
 * it independently reproduces, from the DOM side:
 *   - BUG-01 (cart POST 500) → cart stays empty, no "Go to checkout" affordance
 *     renders → reachability BLOCKER (checkout unreachable from the UI).
 *   - every-PDP 500 (RangeError invalid time) → server-error page → 5xx BLOCKER.
 *   - /us-vs-EUR region wiring → the saved-address country picker offers no US
 *     option, so a saved address usable at /us checkout can't be created, and the
 *     PDP trips the region fallback → region-routing MAJOR.
 * Each is emitted as a verdict-doc lead; the harness files nothing.
 */

import { existsSync } from "fs"
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
  button,
  productLinks,
  addToCartButton,
  goToCheckoutControl,
  readCartSnapshot,
  readPdpPrice,
} from "../lib/selectors"
import { parseMoney, moneyEquals, type OracleResult } from "../lib/oracle"

/**
 * Build a throwaway password for the self-registered persona account at RUNTIME —
 * there is deliberately NO password literal in this source, so the secret scanner
 * (GitGuardian/gitleaks) has nothing to flag. It is assembled from random picks
 * plus a time seed and is guaranteed to satisfy the storefront register validator
 * (RegisterForm/schema.ts + PasswordValidator.tsx): at least 8 chars, one uppercase,
 * one lowercase, one digit, and one special char from the `[!@#$%^&*]` set the zod
 * regex requires. Callers compute it ONCE per persona and reuse it for both the
 * register submit and the follow-up login within the same run.
 */
function makeThrowawayPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  const lower = "abcdefghijkmnpqrstuvwxyz"
  const digit = "23456789"
  const special = "!@#$%^&*" // exactly the set RegisterForm's zod regex accepts
  const pick = (set: string) => set.charAt(Math.floor(Math.random() * set.length))
  const seed = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  // One of every required class up front, then fold in the time+random entropy.
  return pick(upper) + pick(lower) + pick(digit) + pick(special) + seed + pick(special) + pick(upper)
}

/**
 * A registered returning buyer. The journey is a phase machine kept in memory:
 *
 *   register → login → confirm-auth → add-address → confirm-address
 *     → shop → pdp → cart → checkout → orders
 *
 * The account phases are BEST-EFFORT and non-fatal: whatever happens with auth or
 * the saved address, the persona always drives on to the shopping + checkout wall
 * so it reliably reproduces the storefront blockers. Progress is guaranteed by
 * advancing the phase inside `decide()` before returning each action, so the loop
 * never spins on one screen.
 */
class ReturningBuyer extends Persona {
  readonly name = "returning-buyer"
  readonly goal =
    "register/log in via the UI, save an address, complete checkout, and see the order (right total) in /user/orders"

  // Local, recognizable, NON-SECRET test identity: tag test data with a local
  // prefix so it's obvious in the throwaway DB and never a real user.
  // `.test` is a reserved non-routable TLD; the address is never emailed (SMTP is a
  // local no-op) and this is not a credential to any real system.
  private readonly email = `e2e-agent+returning-${Date.now()}@local.test`
  // NON-LITERAL by design: env override, else a runtime-generated throwaway. No
  // password string appears in source. Computed once per instance and reused for
  // both register + login. Satisfies the register validator (8+ / upper / lower /
  // digit / special from [!@#$%^&*]).
  private readonly password = process.env.RETURNING_BUYER_PASSWORD ?? makeThrowawayPassword()
  private readonly firstName = "E2E"
  private readonly lastName = "Buyer"
  private readonly phone = "5550100200"
  private readonly addressName = "E2E Test Buyer"

  private get cc(): string {
    return this.options.countryCode
  }

  /** Build a country-prefixed storefront path ("" → "/us"). */
  private path(sub: string): string {
    return `/${this.cc}${sub}`
  }

  /** An action that navigates to a storefront path (DOM navigation, not the API). */
  private nav(label: string, path: string): Action {
    return act(label, async (page) => {
      await page.goto(path)
      await page.waitForLoadState("domcontentloaded").catch(() => {})
    })
  }

  /** Record a flow/invariant as verified-clean exactly once (so green informs). */
  private clean(flow: string, detail?: string): void {
    const seen = (this.memory.notes.cleanSeen as string[]) ?? (this.memory.notes.cleanSeen = [] as string[])
    if (!seen.includes(flow)) {
      seen.push(flow)
      this.verdict.verifiedClean(flow, detail)
    }
  }

  private n<T>(key: string): T | undefined {
    return this.memory.notes[key] as T | undefined
  }

  // -------------------------------------------------------------------------
  // The policy.
  // -------------------------------------------------------------------------

  async decide(p: Percept, m: PersonaMemory): Promise<Action> {
    const phase = (m.notes.phase as string) ?? "register"
    const url = p.url
    const at = (re: RegExp) => re.test(url)
    const showsLogin = /log in to your account/i.test(p.bodyText)

    switch (phase) {
      // ---- 1. Register through the UI ------------------------------------
      case "register": {
        if (!at(/\/user\/register/)) return this.nav("go to the register page (DOM)", this.path("/user/register"))
        this.clean("register page reachable")
        m.notes.phase = "login"
        return act("register a fresh account via the DOM form", async (page) => {
          await this.fillRegister(page)
        })
      }

      // ---- 2. Log in through the UI --------------------------------------
      case "login": {
        if (showsLogin) {
          m.notes.phase = "confirm-auth"
          return act("log in via the DOM form", async (page) => {
            await this.fillLogin(page)
          })
        }
        if (!m.notes.triedLoginNav) {
          m.notes.triedLoginNav = true
          return this.nav("open the login page (DOM)", this.path("/user"))
        }
        // No login form after navigating — registration already opened a session.
        this.clean("auth via UI", "registration established a session (no login prompt)")
        m.notes.phase = "add-address"
        return this.nav("go to saved addresses (DOM)", this.path("/user/addresses"))
      }

      case "confirm-auth": {
        if (showsLogin) {
          // Login form still up after submitting valid creds — a real auth defect.
          this.verdict.divergence({
            source: "persona",
            severity: "major",
            location: url,
            invariant: "ui-login-succeeds",
            failureScenario: "the login form is still shown after submitting valid credentials — UI login did not establish a session",
            fix: "check the login server action / auth-token cookie handling",
          })
          m.notes.phase = "shop" // keep going as a guest to still reach the storefront wall
          return this.nav("continue as guest to the storefront (DOM)", this.path(""))
        }
        this.clean("auth via UI", "login through the DOM form succeeded")
        m.notes.phase = "add-address"
        return this.nav("go to saved addresses (DOM)", this.path("/user/addresses"))
      }

      // ---- 3. Save a shipping address ------------------------------------
      case "add-address": {
        if (showsLogin) {
          // Not authenticated — skip the saved-address step but keep shopping.
          this.verdict.divergence({
            source: "persona",
            severity: "minor",
            location: url,
            invariant: "saved-address-step-reachable",
            failureScenario: "reached /user/addresses unauthenticated — the saved-address step was skipped",
          })
          m.notes.phase = "shop"
          return this.nav("continue to the storefront (DOM)", this.path(""))
        }
        if (!at(/\/user\/addresses/)) return this.nav("go to addresses (DOM)", this.path("/user/addresses"))
        m.notes.phase = "confirm-address"
        return act("add a saved shipping address via the DOM form", async (page) => {
          await this.fillAddress(page)
        })
      }

      case "confirm-address": {
        if (!m.notes.addrConfirmNav) {
          m.notes.addrConfirmNav = true
          return this.nav("reload addresses to confirm the save (DOM)", this.path("/user/addresses"))
        }
        const created =
          p.bodyText.includes(this.addressName) ||
          (!/no saved shipping addresses/i.test(p.bodyText) && /\bDelete\b/.test(p.buttons.join(",")))
        if (created) {
          this.clean("saved address created via UI")
        } else {
          this.verdict.divergence({
            source: "persona",
            severity: this.n<boolean>("usSelectable") ? "major" : "minor",
            location: url,
            invariant: "saved-address-created",
            failureScenario:
              "could not confirm a saved address after submitting the address form" +
              (this.n<boolean>("usSelectable") === false ? "; the country picker offered no US option (region is EUR-only)" : ""),
            fix: "verify customer address creation; align storefront country routing with the seeded region",
            evidence: {
              usSelectable: this.n("usSelectable"),
              countriesOffered: this.n("countriesOffered"),
              addressOutcome: this.n("addressOutcome"),
            },
          })
        }
        // The /us routing vs EUR-only region means no US-country address can be
        // created, so no saved address will be offered at /us checkout — a
        // region-routing wiring bug that directly defeats this persona's goal.
        if (this.n<boolean>("usSelectable") === false) {
          this.verdict.divergence({
            source: "reachability",
            severity: "major",
            location: this.path("/user/addresses"),
            invariant: "region-routing",
            failureScenario:
              `the saved-address country picker offers no US option while the storefront routes to /${this.cc}; ` +
              `a saved address usable at /${this.cc} checkout cannot be created (EUR-only seeded region vs /us routing)`,
            fix: "seed a region containing the routed country, or route the storefront to the seeded (EUR) region",
            evidence: { countriesOffered: this.n("countriesOffered") },
          })
        }
        m.notes.phase = "shop"
        return this.nav("go to the storefront home (DOM)", this.path(""))
      }

      // ---- 4. Shop: home → product -------------------------------------
      case "shop": {
        if (at(/\/products\//)) {
          m.notes.phase = "pdp"
          return act("land on the product page", async () => {})
        }
        const hasProduct = p.links.some((h) => /\/products\//.test(h))
        if (hasProduct) {
          this.clean("catalog reachable", "product links present on the listing/home")
          m.notes.phase = "pdp"
          return act("open a product (DOM)", async (page) => {
            const first = productLinks(page).first()
            if (await first.count()) {
              await first.click().catch(async () => {
                const href = await page.locator('a[href*="/products/"]').first().getAttribute("href").catch(() => null)
                if (href) await page.goto(href)
              })
              await page.waitForLoadState("domcontentloaded").catch(() => {})
            }
          })
        }
        return this.nav("go to the storefront home (DOM)", this.path(""))
      }

      // ---- 5. PDP: read price + add to cart -----------------------------
      case "pdp": {
        if (p.hasServerError) {
          // The 5xx is already logged as a blocker by the base reachability oracle
          // (this reproduces the every-PDP 500 / RangeError). Stop the journey.
          m.notes.phase = "done-stuck"
          return giveUp("PDP returned a server error (every-PDP 500)")
        }
        const price = await readPdpPrice(this.page).catch(() => null)
        if (typeof price === "number") m.notes.pdpPrice = price
        if (p.notAvailableInRegion) {
          // Region fallback already logged as a major divergence by the base loop.
          m.notes.phase = "done-stuck"
          return giveUp(`PDP shows the region fallback — cannot purchase at /${this.cc}`)
        }
        if (p.outOfStock) {
          m.notes.phase = "done-stuck"
          return giveUp("PDP is out of stock — cannot purchase")
        }
        if (p.addToCart.present && p.addToCart.enabled) {
          this.clean("PDP reachable + purchasable", `add-to-cart affordance enabled ("${p.addToCart.label}")`)
          m.notes.phase = "cart"
          return act("add one unit to the cart (DOM)", async (page) => {
            await addToCartButton(page).click()
            await page.waitForLoadState("networkidle").catch(() => {})
          })
        }
        this.verdict.divergence({
          source: "persona",
          severity: "major",
          location: url,
          invariant: "pdp-add-to-cart-present",
          failureScenario: `no enabled Add-to-Cart affordance on the PDP (label seen: "${p.addToCart.label}")`,
        })
        m.notes.phase = "done-stuck"
        return giveUp("no usable Add-to-Cart on the PDP")
      }

      // ---- 6. Cart → checkout (the reachability gate) -------------------
      case "cart": {
        if (!at(/\/cart/)) return this.nav("go to the cart (DOM)", this.path("/cart"))
        const hasCheckout = (await goToCheckoutControl(this.page).count()) > 0
        if (hasCheckout) {
          this.clean("cart reachable + checkout affordance present")
          m.notes.phase = "checkout"
          return act("go to checkout via the conditional cart link (DOM)", async (page) => {
            await goToCheckoutControl(page).click()
            await page.waitForLoadState("networkidle").catch(() => {})
          })
        }
        // No "Go to checkout" affordance. On this stack the DOM add-to-cart hits
        // the cart POST 500 (BUG-01), so the cart never populates and the link
        // (conditionally rendered on a non-empty cart) is absent — checkout is
        // unreachable from the UI. This is the exact class API-level QA passes over.
        const cartTotal = (this.n<number>("cartTotal") ?? 0)
        const empty = /(bag|cart) is empty|no items|empty/i.test(p.bodyText) || cartTotal === 0
        this.verdict.divergence({
          source: "reachability",
          severity: "blocker",
          location: url,
          invariant: "checkout-reachable-from-cart",
          failureScenario: empty
            ? "after a DOM add-to-cart the cart is empty and no 'Go to checkout' affordance renders — consistent with BUG-01 (cart POST 500 blocking cart creation); checkout is unreachable from the storefront UI"
            : "the cart has items but no 'Go to checkout' affordance renders — the conditionally-rendered checkout link is missing, so checkout is unreachable from the UI",
          fix: "fix the cart POST 500 (BUG-01) and ensure the cart→checkout link renders for a non-empty cart",
          evidence: { cartTotal, url },
        })
        m.notes.phase = "done-stuck"
        return giveUp("checkout unreachable from the cart")
      }

      // ---- 7. Checkout: use the saved address, then place the order -----
      case "checkout": {
        this.clean("checkout page reachable", "the cart→checkout affordance worked")
        m.notes.checkoutTotal = this.n<number>("cartTotal")
        const step = (this.n<number>("checkoutStep") ?? 0)
        if (step > 6) {
          this.verdict.divergence({
            source: "reachability",
            severity: "major",
            location: url,
            invariant: "checkout-completable",
            failureScenario: "could not locate an actionable place-order / continue control to complete checkout within the step budget",
            fix: "verify the checkout delivery/payment/review steps render actionable controls",
          })
          m.notes.phase = "done-stuck"
          return giveUp("checkout could not be completed")
        }
        m.notes.checkoutStep = step + 1

        // First: can the returning buyer reuse a saved address? The picker only
        // renders when there is a saved address in the routed region (country_code
        // === "us"); on the EUR-only stack there is none, which we note once.
        const addrPicker = button(this.page, /choose an address/i)
        const hasAddrPicker = (await addrPicker.count()) > 0
        if (!m.notes.savedAddrNoted) {
          m.notes.savedAddrNoted = true
          if (hasAddrPicker) {
            this.clean("saved address selectable at checkout")
          } else {
            this.verdict.divergence({
              source: "reachability",
              severity: "major",
              location: url,
              invariant: "saved-address-usable-at-checkout",
              failureScenario:
                `no saved-address selector at /${this.cc} checkout — the picker is region-filtered to country_code === '${this.cc}', ` +
                `but the seeded region is EUR-only, so the returning buyer cannot reuse a saved address`,
              fix: `align storefront country routing (/${this.cc}) with the seeded region, or stop region-filtering the saved-address picker`,
              evidence: { usSelectable: this.n("usSelectable"), countriesOffered: this.n("countriesOffered") },
            })
          }
        }
        if (hasAddrPicker) {
          return act("select the saved address at checkout (DOM)", async (page) => {
            await addrPicker.first().click().catch(() => {})
            const opt = page.locator('[data-testid="shipping-address-option"]').first()
            if (await opt.count()) await opt.click().catch(() => {})
          })
        }

        // Place the order if the affordance is present → verify it in orders.
        const place = button(this.page, /place order|complete order|pay now|complete checkout/i)
        if ((await place.count()) > 0) {
          m.notes.phase = "orders"
          return act("place the order (DOM)", async (page) => {
            await place.first().click()
            await page.waitForLoadState("networkidle").catch(() => {})
          })
        }
        // Otherwise advance the multi-step checkout (address "Save", delivery,
        // payment) with the next actionable control.
        const cont = button(this.page, /save|continue|proceed|next|delivery|payment/i)
        if ((await cont.count()) > 0) {
          return act("advance the checkout step (DOM)", async (page) => {
            await cont.first().click()
            await page.waitForLoadState("networkidle").catch(() => {})
          })
        }
        this.verdict.divergence({
          source: "reachability",
          severity: "major",
          location: url,
          invariant: "checkout-completable",
          failureScenario: "the checkout page rendered but no address / continue / place-order control was actionable",
          fix: "inspect checkout step rendering for the seeded region",
        })
        m.notes.phase = "done-stuck"
        return giveUp("checkout dead-end")
      }

      // ---- 8. Orders: assert the order appears with the right total -----
      case "orders": {
        if (!at(/\/user\/orders/)) return this.nav("open /user/orders (DOM)", this.path("/user/orders"))
        if (showsLogin) {
          this.verdict.divergence({
            source: "persona",
            severity: "major",
            location: url,
            invariant: "session-persists-to-orders",
            failureScenario: "redirected to login on /user/orders — the session did not persist through checkout",
          })
          m.notes.phase = "done-stuck"
          return giveUp("not authenticated at /user/orders")
        }
        if (/order set/i.test(p.bodyText)) {
          // The total assertion runs in checkInvariants(); the goal is reached.
          this.clean("order history reachable", "an ORDER SET row is listed for the buyer")
          m.notes.phase = "done-stuck"
          return DONE
        }
        this.verdict.divergence({
          source: "persona",
          severity: "major",
          location: url,
          invariant: "order-appears-after-checkout",
          failureScenario: "completed checkout but no ORDER SET row appears in /user/orders",
          fix: "verify order creation and the customer order listing",
        })
        m.notes.phase = "done-stuck"
        return giveUp("placed order is not listed")
      }

      default:
        return giveUp("journey stopped (see the verdict doc)")
    }
  }

  /**
   * Persona oracle checks (Surfaces refinements): on the cart, reconcile the
   * summary + line sum and cross-check the PDP price against the cart; on the
   * orders page, assert the listed order total equals the checkout total.
   * All DOM-only reads; pure comparisons run through the shared Oracle.
   */
  protected async checkInvariants(p: Percept): Promise<OracleResult[]> {
    const results: OracleResult[] = []

    if (/\/cart/.test(p.url) && !p.hasServerError) {
      const snap = await readCartSnapshot(this.page).catch(() => null)
      if (snap) {
        this.memory.notes.cartTotal = snap.total
        const cartPrice = snap.itemsTotal ?? snap.total
        this.memory.notes.cartPrice = cartPrice

        const rSum = this.oracle.cartTotalEqualsLineSum(snap)
        const rRecon = this.oracle.totalsReconcile(snap)
        results.push(rSum, rRecon)
        if (rSum.status === "pass") this.clean("cart-total==line-sum", rSum.detail)
        if (rRecon.status === "pass") this.clean("totals-reconcile", rRecon.detail)

        const pdp = this.n<number>("pdpPrice")
        if (typeof pdp === "number" && typeof snap.itemsTotal === "number") {
          const rPrice = this.oracle.priceConsistency({ pdp, cart: snap.itemsTotal })
          results.push(rPrice)
          if (rPrice.status === "pass") this.clean("price-consistent-across-funnel", rPrice.detail)
        }
      }
    }

    if (/\/user\/orders/.test(p.url) && /order set/i.test(p.bodyText)) {
      const totalText = await this.page
        .locator("h2", { hasText: /total:/i })
        .first()
        .innerText()
        .catch(() => "")
      const shown = parseMoney(totalText)
      const expected = this.n<number>("checkoutTotal") ?? this.n<number>("cartTotal")
      if (typeof expected === "number" && shown != null) {
        if (moneyEquals(shown, expected)) {
          this.clean("order-total==checkout-total", `order lists ${shown}, matching the checkout total`)
        } else {
          results.push({
            invariant: "order-total==checkout-total",
            status: "fail",
            severity: "major",
            detail: `order history lists total ${shown} but the checkout total was ${expected}`,
            evidence: { shown, expected },
          })
        }
      } else {
        // No-silent-caps: record that the total could not be cross-checked.
        this.verdict.note(
          `order-total check skipped: shown=${shown ?? "n/a"} expected=${expected ?? "n/a"} (status is shown on the order detail page, not the list)`
        )
      }
    }

    return results
  }

  // -------------------------------------------------------------------------
  // DOM form fillers (page-only). Account-flow fillers swallow their own errors
  // so an account hiccup never stops the persona from reaching the storefront
  // wall where BUG-01 / the PDP 500 live.
  // -------------------------------------------------------------------------

  private async fillRegister(page: import("@playwright/test").Page): Promise<void> {
    try {
      await page.getByLabel("First name", { exact: true }).fill(this.firstName)
      await page.getByLabel("Last name", { exact: true }).fill(this.lastName)
      await page.getByLabel("E-mail", { exact: true }).fill(this.email)
      await page.getByLabel("Phone", { exact: true }).fill(this.phone)
      await page.getByLabel("Password", { exact: true }).fill(this.password)
      await button(page, /create account/i).first().click()
      await page.waitForLoadState("networkidle").catch(() => {})
      this.memory.notes.registerOutcome = "submitted"
    } catch (e) {
      this.memory.notes.registerOutcome = `error: ${String(e)}`
    }
  }

  private async fillLogin(page: import("@playwright/test").Page): Promise<void> {
    try {
      await page.getByLabel("E-mail", { exact: true }).fill(this.email)
      await page.getByLabel("Password", { exact: true }).fill(this.password)
      await button(page, /^log in$/i).first().click()
      await page.waitForLoadState("networkidle").catch(() => {})
      this.memory.notes.loginOutcome = "submitted"
    } catch (e) {
      this.memory.notes.loginOutcome = `error: ${String(e)}`
    }
  }

  private async fillAddress(page: import("@playwright/test").Page): Promise<void> {
    try {
      await button(page, /add address/i).first().click()
      // Wait for the modal form to mount.
      await page.getByLabel("Address name", { exact: true }).waitFor({ timeout: 10_000 })
      await page.getByLabel("Address name", { exact: true }).fill(this.addressName)
      await page.getByLabel("First name", { exact: true }).fill(this.firstName)
      await page.getByLabel("Last name", { exact: true }).fill(this.lastName)
      await page.getByLabel("Address", { exact: true }).fill("1 Test Street")
      await page.getByLabel("City", { exact: true }).fill("Test City")
      await page.getByLabel("Postal code", { exact: true }).fill("00000")
      await page.getByLabel("State / Province", { exact: true }).fill("X")

      // Country is a headless-ui Listbox ("Choose a country"). Capture the offered
      // countries so we can prove US is (or isn't) selectable, then pick the first.
      const countryBtn = button(page, /choose a country/i)
      if ((await countryBtn.count()) > 0) {
        await countryBtn.first().click().catch(() => {})
        const opts = page.locator('[data-testid="shipping-address-option"]')
        const labels = await opts.allInnerTexts().catch(() => [] as string[])
        this.memory.notes.countriesOffered = labels
        this.memory.notes.usSelectable = labels.some((l) => /united states|^\s*us\s*$/i.test(l))
        if ((await opts.count()) > 0) await opts.first().click().catch(() => {})
      } else {
        this.memory.notes.usSelectable = false
        this.memory.notes.countriesOffered = []
      }

      await page.getByLabel("Phone", { exact: true }).fill(this.phone)
      await button(page, /save address/i).first().click()
      await page.waitForLoadState("networkidle").catch(() => {})
      this.memory.notes.addressOutcome = "submitted"
    } catch (e) {
      this.memory.notes.addressOutcome = `error: ${String(e)}`
    }
  }
}

test("returning buyer: register/login, saved address, checkout, order in /user/orders", async ({ agent }, testInfo) => {
  const persona = new ReturningBuyer(agent, {
    testInfo,
    // Leads-not-failures: keep DRIVING past a divergence (5xx PDP / region
    // fallback) rather than halting on the first one, so the journey surfaces
    // every lead it can reach. maxSteps/stuck still bound the run.
    options: { maxSteps: 45, stuckThreshold: 6, stopOnOracleViolation: false },
  })

  const result = await persona.run()

  // Surface the headline + every ranked lead in the report, then emit the doc.
  persona.verdict.annotate(testInfo)
  const verdictPath = persona.verdict.write(testInfo.outputDir)
  testInfo.annotations.push({ type: "verdict-doc", description: verdictPath })

  // Leads-not-failures: on a healthy stack the returning-buyer
  // journey completes clean; on today's stack it REPRODUCES BUG-01 (cart POST
  // 500 → checkout unreachable), the every-PDP 500, and the /us-vs-EUR region
  // wiring. Those are REPORTED as ranked leads in the verdict doc (headline +
  // lead:* annotations), NOT asserted away. This spec asserts only that the
  // HARNESS ran correctly: a terminal StopReason with no unhandled throw and a
  // verdict doc emitted. instrument.spec.ts is the one spec that hard-asserts.
  expect(result.persona).toBe("returning-buyer")
  expect(result.stop).not.toBe("error")
  expect(existsSync(verdictPath)).toBeTruthy()
})
