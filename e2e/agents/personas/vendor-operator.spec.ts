/**
 * vendor-operator.spec.ts — persona #5.
 *
 * GOAL (cross-surface loop): log into the vendor panel (:7001), open a product
 * the vendor manages and edit it (append a unique marker to the title and save),
 * then cross to the storefront (:3000) as a buyer and verify the change
 * propagated. When the write path isn't drivable, the check DOWNGRADES to
 * read-only catalog-propagation (does the vendor's product render to a buyer at
 * all?) and says so out loud (no-silent-caps).
 *
 * DOM-ONLY, non-negotiable: this persona uses ONLY `page` / `browser`
 * (via the `agent` fixture from ../lib/persona). It NEVER imports ../lib/
 * differential and NEVER touches Playwright's `request` context or any
 * /store /admin /vendor HTTP client — being unable to cheat via the API is the
 * whole point. `targets()` from ../lib/guard is imported only for loopback URL
 * strings (no network). Credentials come from env (VENDOR_EMAIL /
 * VENDOR_PASSWORD) — NO secret is baked into this file.
 *
 * Known bugs this persona independently surfaces on the buyer-verify leg:
 *   - every-PDP 500 (RangeError: invalid time)  → auto reachability → BLOCKER
 *   - /us-default vs EUR-only region routing     → region-fallback   → MAJOR
 * plus vendor-panel reachability/auth as a possible stuck-report on the vendor leg.
 */

import { existsSync } from "fs"
import type { Page } from "@playwright/test"
import {
  test,
  expect,
  Persona,
  act,
  giveUp,
  type Action,
  type Percept,
  type PersonaMemory,
} from "../lib/persona"
import { targets } from "../lib/guard"
import { productLinks, pdpTitle } from "../lib/selectors"
import type { OracleResult } from "../lib/oracle"

// Loopback URL strings only (targets() makes ZERO network calls). The fixture
// + run() enforce loopback via assertLoopbackTargets() before anything loads.
const T = targets()
const VENDOR = T.vendor.replace(/\/$/, "") // e.g. http://localhost:7001
const STORE = T.storefront.replace(/\/$/, "") // e.g. http://localhost:3000

// Credentials come from the environment only. No default, no secret in-repo.
const VENDOR_EMAIL = process.env.VENDOR_EMAIL
const VENDOR_PASSWORD = process.env.VENDOR_PASSWORD
const HAS_CREDS = Boolean(VENDOR_EMAIL && VENDOR_PASSWORD)

/** Typed view over the persona's free-form memory.notes for this state machine. */
type VendorNotes = {
  reachedVendor?: boolean
  attemptedLogin?: boolean
  loggedIn?: boolean
  openedProducts?: boolean
  triedOpenProduct?: boolean
  captured?: boolean
  productName?: string
  /** Set to a unique marker string iff the title edit was written + saved. */
  marker?: string
  writeMode?: "wrote" | "read-only"
  vendorDone?: boolean
  altListingTried?: boolean
}

class VendorOperator extends Persona {
  readonly name = "vendor-operator"
  readonly goal =
    "vendor logs into :7001, edits a product, then a buyer verifies the change propagated to :3000"

  /** Typed accessor for the mutable notes bag. */
  private get notes(): VendorNotes {
    return this.memory.notes as VendorNotes
  }

  // ------------------------------------------------------------------
  // decide() — a two-phase state machine: vendor edit → buyer verify.
  // ------------------------------------------------------------------
  async decide(p: Percept, _m: PersonaMemory): Promise<Action> {
    const n = this.notes
    const onVendor = p.url.startsWith(VENDOR)
    const onStore = p.url.startsWith(STORE)

    // ===== Phase 1 — vendor panel (:7001): log in, open a product, edit it. =====
    if (!n.vendorDone) {
      if (!onVendor) {
        n.reachedVendor = true
        return act("open the vendor panel", (page) => page.goto(VENDOR + "/"))
      }

      // A server error on the vendor panel is auto-logged by observe(); if the
      // login form is present we must authenticate before anything else.
      if (await this.hasLoginForm()) {
        if (!HAS_CREDS) {
          this.verdict.divergence({
            source: "persona",
            location: p.url,
            severity: "major",
            invariant: "vendor-auth",
            failureScenario:
              "vendor panel requires login but VENDOR_EMAIL/VENDOR_PASSWORD were not provided; " +
              "the authenticated vendor→storefront write loop cannot be exercised",
            evidence: { vendorUrl: VENDOR },
          })
          return giveUp("no vendor credentials")
        }
        if (!n.attemptedLogin) {
          n.attemptedLogin = true
          return act("log into the vendor panel", (page) => this.performLogin(page))
        }
        // Login was submitted but the form is still showing → auth failed.
        this.verdict.divergence({
          source: "persona",
          location: p.url,
          severity: "major",
          invariant: "vendor-auth",
          failureScenario:
            "vendor login with the supplied credentials did not authenticate " +
            "(login form still present after submit)",
          evidence: { vendorUrl: VENDOR },
        })
        return giveUp("vendor login failed")
      }

      // Authenticated (no login form on the vendor origin).
      n.loggedIn = true
      const onProduct = /\/products\/[A-Za-z0-9]/.test(p.url)

      if (!onProduct) {
        if (!n.openedProducts) {
          n.openedProducts = true
          return act("open the vendor product list", (page) => page.goto(VENDOR + "/products"))
        }
        if (!n.triedOpenProduct) {
          n.triedOpenProduct = true
          return act("open the first vendor product", (page) => this.openFirstVendorProduct(page))
        }
        this.verdict.divergence({
          source: "persona",
          location: p.url,
          severity: "major",
          invariant: "vendor-catalog",
          failureScenario:
            `could not open a product from the vendor catalog list (${p.url}) — ` +
            "no product rows/links were found",
        })
        return giveUp("no vendor products to open")
      }

      // On a vendor product page: capture identity, then attempt the edit.
      if (!n.captured) {
        n.captured = true
        n.productName = await this.captureProductName(p)
        return act("edit the vendor product (append a marker) and save", (page) =>
          this.attemptEdit(page)
        )
      }

      // Edit attempt resolved (wrote or downgraded). Move to the buyer leg.
      if (!n.writeMode) n.writeMode = "read-only"
      if (n.writeMode === "read-only") {
        this.verdict.note(
          "vendor edit downgraded to read-only catalog-propagation: no editable title field + " +
            "save affordance was found on the product page (no-silent-caps)"
        )
      }
      n.vendorDone = true
      return act("cross to the storefront as a buyer", (page) => page.goto(STORE + "/us"))
    }

    // ===== Phase 2 — storefront (:3000): find the product, verify propagation. =====
    if (!onStore) {
      return act("cross to the storefront as a buyer", (page) => page.goto(STORE + "/us"))
    }

    const onPdp = /\/products\//.test(p.url)
    if (onPdp) {
      // Propagation is asserted by checkInvariants()/goalReached(); if the loop
      // still calls decide() here, the check was inconclusive (e.g. no name).
      return giveUp("on storefront PDP but cross-surface propagation was inconclusive")
    }

    // On a storefront listing: make sure buyer-visible product links exist, then
    // open the one matching the vendor's product (fallback: the first link).
    const links = productLinks(this.page)
    if ((await links.count()) === 0) {
      if (!n.altListingTried) {
        n.altListingTried = true
        return act("open the storefront catalog listing", (page) => page.goto(STORE + "/us/store"))
      }
      this.verdict.divergence({
        source: "persona",
        location: p.url,
        severity: "major",
        invariant: "cross-surface-catalog-propagation",
        failureScenario:
          `no product links are reachable to a buyer on the storefront listing (${p.url}); ` +
          "the vendor-managed catalog does not render for buyers",
        evidence: { productName: n.productName },
      })
      return giveUp("no storefront product links")
    }
    return act("open the product on the storefront", (page) => this.openMatchingStoreProduct(page))
  }

  // ------------------------------------------------------------------
  // Cross-surface invariant — the whole point of this persona.
  // ------------------------------------------------------------------
  /** Only asserts on a rendered storefront PDP during the buyer leg. */
  private verifyPropagation(p: Percept): OracleResult | null {
    const n = this.notes
    if (!n.vendorDone) return null
    if (!p.url.startsWith(STORE)) return null
    if (!/\/products\//.test(p.url)) return null

    const hay = `${p.title} ${p.headings.join(" ")} ${p.bodyText}`.toLowerCase()

    if (n.marker) {
      const ok = hay.includes(n.marker.toLowerCase())
      return {
        invariant: "cross-surface-edit-propagation",
        status: ok ? "pass" : "fail",
        severity: "major",
        detail: ok
          ? `vendor edit marker "${n.marker}" is visible on the storefront PDP — edit propagated`
          : `vendor edit marker "${n.marker}" is NOT visible on the storefront PDP — edit did not propagate`,
        evidence: { marker: n.marker, productName: n.productName, url: p.url },
      }
    }

    const name = (n.productName || "").toLowerCase().trim()
    if (!name) return null
    const firstWord = name.split(/\s+/)[0]
    const ok = hay.includes(name) || (firstWord.length > 2 && hay.includes(firstWord))
    return {
      invariant: "cross-surface-catalog-propagation",
      status: ok ? "pass" : "fail",
      severity: "major",
      detail: ok
        ? `vendor-managed product "${n.productName}" renders on the storefront PDP for a buyer`
        : `vendor-managed product "${n.productName}" did not render on the storefront PDP`,
      evidence: { productName: n.productName, url: p.url },
    }
  }

  protected checkInvariants(percept: Percept): OracleResult[] {
    const r = this.verifyPropagation(percept)
    return r ? [r] : []
  }

  goalReached(percept: Percept, _m: PersonaMemory): boolean {
    return this.verifyPropagation(percept)?.status === "pass"
  }

  // ------------------------------------------------------------------
  // DOM helpers (page-only; reads + writes go through Playwright's `page`).
  // ------------------------------------------------------------------
  private async hasLoginForm(): Promise<boolean> {
    return (await this.page.locator('input[type="password"]').count()) > 0
  }

  private async performLogin(page: Page): Promise<void> {
    const email = page
      .locator('input[type="email"], input[name="email"]')
      .filter({ visible: true })
      .first()
    const pass = page.locator('input[type="password"]').filter({ visible: true }).first()
    if (await email.count()) await email.fill(VENDOR_EMAIL as string)
    if (await pass.count()) await pass.fill(VENDOR_PASSWORD as string)
    const submit = page
      .getByRole("button", { name: /sign in|log in|continue|submit/i })
      .filter({ visible: true })
      .first()
    if (await submit.count()) await submit.click()
    else if (await pass.count()) await pass.press("Enter")
    await page.waitForLoadState("networkidle").catch(() => {})
  }

  private async openFirstVendorProduct(page: Page): Promise<void> {
    const links = page.locator('a[href*="/products/"]').filter({ visible: true })
    if (await links.count()) {
      await links.first().click()
      await page.waitForLoadState("domcontentloaded").catch(() => {})
      return
    }
    // Fallback: a data-grid row (Medusa/Mercur render products in a table).
    const rows = page.getByRole("row")
    if ((await rows.count()) > 1) {
      await rows.nth(1).click()
      await page.waitForLoadState("domcontentloaded").catch(() => {})
    }
  }

  private async captureProductName(p: Percept): Promise<string> {
    let name = ((await pdpTitle(this.page).textContent().catch(() => "")) || "").trim()
    if (name.length < 2) name = (p.headings.find((h) => h.trim().length > 1) || "").trim()
    return name
  }

  /**
   * Best-effort title edit: find a visible text input whose current value looks
   * like the product name, append a unique marker, and save. If that affordance
   * isn't present, record writeMode="read-only" so the buyer leg falls back to
   * catalog-propagation. Optimistic on save success — if the marker never shows
   * on the storefront, verifyPropagation() reports that as the (real) failure.
   */
  private async attemptEdit(page: Page): Promise<void> {
    const n = this.notes
    try {
      const inputs = page
        .locator('input[type="text"], input:not([type])')
        .filter({ visible: true })
      const first = (n.productName || "").toLowerCase().split(/\s+/)[0]
      const count = Math.min(await inputs.count(), 8)
      for (let i = 0; i < count; i++) {
        const inp = inputs.nth(i)
        const val = ((await inp.inputValue().catch(() => "")) || "").trim()
        const looksLikeTitle =
          val.length > 1 && (!first || val.toLowerCase().includes(first) || first.includes(val.toLowerCase()))
        if (!looksLikeTitle) continue
        const marker = "DR" + Date.now().toString().slice(-6)
        await inp.fill(`${val} ${marker}`)
        const save = page
          .getByRole("button", { name: /save|publish|update/i })
          .filter({ visible: true })
          .first()
        if (await save.count()) {
          await save.click()
          await page.waitForLoadState("networkidle").catch(() => {})
          n.writeMode = "wrote"
          n.marker = marker
          return
        }
      }
    } catch {
      /* fall through to the read-only downgrade */
    }
    n.writeMode = "read-only"
  }

  private async openMatchingStoreProduct(page: Page): Promise<void> {
    const loc = productLinks(page)
    const texts = await loc.allInnerTexts().catch(() => [] as string[])
    let idx = 0
    const name = (this.notes.productName || "").toLowerCase()
    if (name) {
      const found = texts.findIndex((t) => t.toLowerCase().includes(name))
      if (found >= 0) idx = found
    }
    await loc.nth(idx).click()
    await page.waitForLoadState("domcontentloaded").catch(() => {})
  }
}

test("vendor-operator edits the catalog and a buyer verifies propagation via the DOM", async ({
  agent,
}, testInfo) => {
  const persona = new VendorOperator(agent, { testInfo })
  const result = await persona.run()

  // No-silent-caps: if creds were absent the authenticated write loop was not run.
  if (!HAS_CREDS) {
    persona.verdict.note(
      "vendor credentials not supplied via VENDOR_EMAIL/VENDOR_PASSWORD; the authenticated " +
        "vendor→storefront write loop could not be exercised this run (no-silent-caps)"
    )
  }
  // Surface the headline + every ranked lead in the Playwright report, then emit
  // the verdict doc as the run artifact.
  persona.verdict.annotate(testInfo)
  const verdictPath = persona.verdict.write(testInfo.outputDir)

  // The harness produces LEADS, not red tests: divergences (incl. the known
  // every-PDP 500 / region-fallback on the buyer leg) are reported in the
  // verdict doc + lead:* annotations, NOT asserted away. The test verifies the
  // instrument itself ran end-to-end and emitted the verdict artifact.
  expect(result.persona).toBe("vendor-operator")
  expect(["goal-reached", "stuck", "funnel-blocked", "oracle-violated", "max-steps", "error"]).toContain(result.stop)
  expect(result.finalUrl).toBeTruthy()
  expect(existsSync(verdictPath)).toBeTruthy()
})
