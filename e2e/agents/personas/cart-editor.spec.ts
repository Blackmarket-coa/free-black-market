/**
 * cart-editor.spec.ts — Persona #4 "Indecisive Cart Editor".
 *
 * GOAL: add an item → change its quantity → remove it → RELOAD, asserting that
 *   (a) the cart SURVIVES a page reload (client state / persistence), and
 *   (b) the summary TOTALS RECOMPUTE when the quantity changes.
 *
 * This is the client-state/persistence lane of the Surfaces layer:
 * the class of bug an API test never sees because it POSTs a cart and reads it
 * back over the same request — it never reloads the browser and never re-hydrates
 * client state. Here the agent must find the buttons and trust only the screen.
 *
 * DOM-ONLY, non-negotiable: this persona uses ONLY `page`/`browser`
 * (handed in via the `agent` fixture from ../lib/persona). It NEVER imports or
 * touches Playwright's `request` context or any /store /admin /vendor HTTP
 * client, and it NEVER imports ../lib/differential (harness-only). The only
 * non-runtime import from @playwright/test is the `Page`/`Locator` *types* for
 * the local selector helpers — a compile-time erasure, not an HTTP client.
 */

import { existsSync } from "fs"
import type { Locator, Page } from "@playwright/test"
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
  readCartSnapshot,
  readPdpPrice,
} from "../lib/selectors"
import { moneyEquals, type OracleResult } from "../lib/oracle"

// ---------------------------------------------------------------------------
// Local DOM-only selector helpers (page-scoped; no request context).
// ---------------------------------------------------------------------------

/** True when the URL is a product-detail page. */
function isPdp(url: string): boolean {
  return /\/products\//.test(url)
}

/** True when the URL is the cart page. */
function isCart(url: string): boolean {
  return /\/cart(?:[/?#]|$)/.test(url)
}

const EMPTY_CART_RE = /shopping cart is currently empty/i

/** The "+" quantity stepper (UpdateCartItemButton renders a text "+" button). */
function qtyPlus(page: Page): Locator {
  return page.getByRole("button", { name: "+", exact: true }).first()
}

/**
 * The per-line delete control (DeleteCartItemButton) is an UNTESTID'd, unlabelled
 * icon-only button (a <BinIcon> svg, no accessible name) — a known selector-rot
 * fragile point. Resolve it resiliently by scoping to the cart-line
 * card that also owns the "+" stepper, then taking the button that wraps an svg
 * (the +/- steppers carry text, not an svg, so this disambiguates the bin).
 */
function removeButton(page: Page): Locator {
  const card = qtyPlus(page).locator(
    'xpath=ancestor::div[contains(@class,"border")][1]'
  )
  return card.locator("button").filter({ has: page.locator("svg") }).first()
}

// ---------------------------------------------------------------------------
// The persona.
// ---------------------------------------------------------------------------

class CartEditor extends Persona {
  readonly name = "cart-editor"
  readonly goal =
    "add an item, change qty, remove it, and reload — cart must survive reload and totals must recompute"

  /**
   * Phase-driven policy. Each step advances one phase; before/after snapshots
   * for the persistence + recompute invariants are stashed in `memory.notes`
   * (percept alone can't carry cross-step comparisons).
   */
  async decide(percept: Percept, memory: PersonaMemory): Promise<Action> {
    const notes = memory.notes as Record<string, unknown>
    const phase = (notes.phase as string) ?? "goto-home"
    const url = percept.url

    // ---- 1. Open the storefront home (seeded /us country segment). ----
    if (phase === "goto-home") {
      notes.phase = "open-pdp"
      return act("open storefront home (/us)", async (page) => {
        await page.goto("/us")
      })
    }

    // ---- 2. Reach a product page with an enabled Add-to-Cart. ----
    if (phase === "open-pdp") {
      if (isPdp(url)) {
        // A 5xx / server-error PDP is auto-logged by observe() as a blocker lead;
        // with stopOnOracleViolation:false we KEEP DRIVING. An error page exposes
        // no usable Add-to-Cart, so it falls into the soft dead-end below and we
        // try another product (surfacing the every-PDP-500 across the catalog).
        if (percept.notAvailableInRegion || percept.outOfStock || !percept.addToCart.present) {
          // Region-fallback / OOS / no control: try a different product.
          notes.productIdx = ((notes.productIdx as number) ?? 0) + 1
          return act("region/OOS PDP — back to listing to try another", async (page) => {
            await page.goto("/us")
          })
        }
        if (percept.addToCart.enabled) {
          notes.pdpPrice = await readPdpPrice(this.page)
          notes.phase = "go-to-cart"
          return act("add the item to the cart", async (page) => {
            await addToCartButton(page).click()
            // add-to-cart posts + revalidates; let the mini-cart/state settle.
            await page.waitForTimeout(1200)
          })
        }
        return giveUp("Add-to-Cart control is present but disabled")
      }

      // Not on a PDP yet: click the next untried product link on the listing.
      if (notes.exhausted) {
        return giveUp("no product exposed an enabled Add-to-Cart (region/stock)")
      }
      const idx = (notes.productIdx as number) ?? 0
      return act(`open product #${idx} from the listing`, async (page) => {
        const links = productLinks(page)
        if (idx >= (await links.count())) {
          notes.exhausted = true
          return
        }
        await links.nth(idx).click()
      })
    }

    // ---- 3. Go to the cart page. ----
    if (phase === "go-to-cart") {
      notes.phase = "capture-baseline"
      return act("navigate to the cart", async (page) => {
        await page.goto("/us/cart")
      })
    }

    // ---- 4. Baseline: the item must actually be in the cart. ----
    if (phase === "capture-baseline") {
      if (EMPTY_CART_RE.test(percept.bodyText)) {
        // Add-to-Cart silently failed → cart never populated (BUG-01 class:
        // cart POST 500). Checkout is unreachable. This is a blocker lead.
        this.verdict.divergence({
          source: "persona",
          location: url,
          failureScenario:
            "after Add-to-Cart the cart page renders EMPTY — the line item never " +
            "persisted to the cart (cart POST likely 500; BUG-01 class). The buyer " +
            "cannot edit or check out a cart that never formed.",
          severity: "blocker",
          invariant: "cart-persists-item",
          evidence: { pdpPrice: notes.pdpPrice ?? null },
        })
        return giveUp("cart is empty after Add-to-Cart")
      }
      const snap = await readCartSnapshot(this.page)
      notes.totalBeforeReload = snap.total
      notes.itemsBeforeReload = snap.itemsTotal ?? null
      notes.phase = "assert-persist"
      return act("reload the cart page (persistence probe)", async (page) => {
        await page.reload()
      })
    }

    // ---- 5. Persistence: the cart must survive a plain reload. ----
    if (phase === "assert-persist") {
      const before = notes.totalBeforeReload as number | undefined
      if (EMPTY_CART_RE.test(percept.bodyText)) {
        this.verdict.divergence({
          source: "persona",
          location: url,
          failureScenario:
            `the cart held a line (total ${before}) but rendered EMPTY after a plain ` +
            "page reload — client cart state did not persist across navigation/hydration.",
          severity: "blocker",
          invariant: "cart-survives-reload",
          evidence: { totalBeforeReload: before ?? null },
        })
        return giveUp("cart did not survive reload")
      }
      const snap = await readCartSnapshot(this.page)
      if (
        before != null &&
        snap.total != null &&
        !moneyEquals(snap.total, before)
      ) {
        this.verdict.divergence({
          source: "persona",
          location: url,
          failureScenario:
            `cart grand total changed across a plain reload with no edits: ` +
            `${before} before → ${snap.total} after. A reload must not mutate totals.`,
          severity: "major",
          invariant: "cart-total-stable-on-reload",
          evidence: { before, after: snap.total },
        })
      } else {
        this.verdict.verifiedClean(
          "cart-survives-reload",
          `line + total (${snap.total}) preserved across a full page reload`
        )
      }
      notes.totalBeforeQty = snap.total
      notes.phase = "assert-recompute"
      return act("increase quantity by 1 (recompute probe)", async (page) => {
        await qtyPlus(page).click()
        // 500ms debounce (UpdateCartItemButton) + server-action revalidation.
        await page.waitForTimeout(1500)
      })
    }

    // ---- 6. Recompute: totals must move when quantity changes. ----
    if (phase === "assert-recompute") {
      const before = notes.totalBeforeQty as number | undefined
      const snap = await readCartSnapshot(this.page)
      if (before != null && snap.total != null) {
        if (snap.total > before + 0.005) {
          this.verdict.verifiedClean(
            "totals-recompute-on-qty-change",
            `grand total recomputed ${before} → ${snap.total} after +1 qty`
          )
        } else {
          this.verdict.divergence({
            source: "persona",
            location: url,
            failureScenario:
              `quantity was increased from 1 → 2 but the grand total did not grow ` +
              `(${before} → ${snap.total}). Totals did not recompute on the qty change.`,
            severity: "major",
            invariant: "totals-recompute-on-qty-change",
            evidence: { before, after: snap.total },
          })
        }
      }
      notes.totalAfterQty = snap.total
      notes.phase = "assert-removed"
      return act("remove the line item", async (page) => {
        const btn = removeButton(page)
        if ((await btn.count()) === 0) {
          notes.removeUnavailable = true
          return
        }
        await btn.click()
        await page.waitForTimeout(1500)
      })
    }

    // ---- 7. Removal empties the (single-line) cart → done. ----
    if (phase === "assert-removed") {
      if (notes.removeUnavailable) {
        this.verdict.note(
          "remove control (BinIcon delete button) is untestid'd/unlabelled and was " +
            "not locatable via resilient selectors — remove step skipped. " +
            "Recommend filing a finding to add data-testid=\"delete-cart-item\"."
        )
        return DONE
      }
      const snap = await readCartSnapshot(this.page)
      const empty = EMPTY_CART_RE.test(percept.bodyText)
      if (empty || (snap.total != null && moneyEquals(snap.total, 0))) {
        this.verdict.verifiedClean(
          "remove-empties-cart",
          "removing the only line item emptied the cart / zeroed the total"
        )
      } else {
        this.verdict.divergence({
          source: "persona",
          location: url,
          failureScenario:
            `after removing the only line item the cart still shows a non-zero total ` +
            `(${snap.total}). Removal did not update the cart state.`,
          severity: "minor",
          invariant: "remove-updates-cart",
          evidence: { totalAfterRemove: snap.total },
        })
      }
      return DONE
    }

    return giveUp(`unknown phase: ${phase}`)
  }

  /**
   * Per-step oracle check: whenever we are on a non-empty cart page, the summary
   * must reconcile (items + shipping + tax − discount == total). A hard failure
   * stops the run (stopOnOracleViolation) as a legitimate finding. Uses the
   * page DOM only (no request context).
   */
  protected async checkInvariants(percept: Percept): Promise<OracleResult[]> {
    if (!isCart(percept.url)) return []
    if (EMPTY_CART_RE.test(percept.bodyText)) return []
    const snap = await readCartSnapshot(this.page)
    const rec = this.oracle.totalsReconcile(snap)
    return rec.status === "skipped" ? [] : [rec]
  }
}

// ---------------------------------------------------------------------------
// The DOM-only Playwright test (project: "agents").
// ---------------------------------------------------------------------------

test("indecisive cart editor: cart survives reload and totals recompute", async ({ agent }, testInfo) => {
  const persona = new CartEditor(agent, {
    testInfo,
    // Leads-not-failures: keep DRIVING the journey past a divergence (5xx PDP /
    // failed oracle) instead of halting on the first one, so one run surfaces
    // every lead it can reach. The maxSteps/stuck backstops still terminate it.
    options: { stopOnOracleViolation: false },
  })
  const result = await persona.run()

  // Surface the headline + every ranked lead in the Playwright report, then emit
  // the verdict doc as the run artifact whatever the outcome.
  persona.verdict.annotate(testInfo)
  const verdictPath = persona.verdict.write(testInfo.outputDir)

  // Leads-not-failures: this spec asserts the HARNESS ran
  // correctly — it reached a terminal StopReason without an unhandled throw and
  // emitted a verdict doc — NOT app correctness. Known cart/PDP bugs (empty-after-
  // add / no-survive-reload / 5xx PDP) are REPORTED as ranked leads in that doc
  // (see the verdict headline + lead:* annotations), never asserted away.
  // instrument.spec.ts is the one spec that hard-asserts app/harness goldens.
  expect(result.persona).toBe("cart-editor")
  expect(result.stop).not.toBe("error")
  expect(existsSync(verdictPath)).toBeTruthy()
})
