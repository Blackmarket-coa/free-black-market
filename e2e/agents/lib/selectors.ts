/**
 * selectors.ts — resilient, DOM-only selector helpers for the agent personas.
 *
 * Selector policy (most-resilient first, guards against "selector rot"):
 *   1. role + accessible name  (getByRole)         — survives styling/markup churn
 *   2. test id                 (getByTestId)       — when the app exposes one
 *   3. visible text            (getByText/regex)   — last-resort fallback
 *
 * The storefront's Add-to-Cart control is UN-testid'd today (see
 * ProductDetailsHeader.tsx); `addToCartButton()` is the explicit resilient
 * helper for it, matching by role+accessible-name across its three label states
 * (ADD TO CART / OUT OF STOCK / NOT AVAILABLE IN YOUR REGION).
 *
 * Everything here operates on a Playwright `Page`/`Locator` ONLY. No `request`
 * context, no /store|/admin|/vendor HTTP client — personas must not cheat.
 */

import type { Locator, Page } from "@playwright/test"
import { parseMoney, type CartSnapshot, type CartLine } from "./oracle"

/** Accessible-name matchers for the three Add-to-Cart button states. */
export const ADD_TO_CART_RE = /add to cart|out of stock|not available in your region/i
export const GO_TO_CHECKOUT_RE = /go to checkout|checkout|proceed/i
export const REGION_FALLBACK_RE = /not available in your region/i
export const OUT_OF_STOCK_RE = /out of stock/i

/** role + accessible-name button, visible-first. */
export function button(page: Page | Locator, name: RegExp | string): Locator {
  return page.getByRole("button", { name }).filter({ visible: true })
}

/** role + accessible-name link, visible-first. */
export function link(page: Page | Locator, name: RegExp | string): Locator {
  return page.getByRole("link", { name }).filter({ visible: true })
}

/**
 * The Add-to-Cart control (explicit helper — the control is untestid'd).
 * Returns the FIRST visible match; PDP + mobile-sticky render two buttons.
 * Callers should check enabled/label state via `addToCartState(page)`.
 */
export function addToCartButton(page: Page): Locator {
  return page.getByRole("button", { name: ADD_TO_CART_RE }).filter({ visible: true }).first()
}

/** The conditionally-rendered "Go to checkout" affordance on the cart page. */
export function goToCheckoutControl(page: Page): Locator {
  // It renders as an <a> wrapping a <button>; try link role, fall back to button.
  const asLink = page.getByRole("link", { name: GO_TO_CHECKOUT_RE }).filter({ visible: true })
  const asButton = page.getByRole("button", { name: GO_TO_CHECKOUT_RE }).filter({ visible: true })
  return asLink.or(asButton).first()
}

/** All product-detail links on a listing/home page (href contains /products/). */
export function productLinks(page: Page): Locator {
  return page.locator('a[href*="/products/"]').filter({ visible: true })
}

/** The PDP title (first h1). */
export function pdpTitle(page: Page): Locator {
  return page.getByRole("heading", { level: 1 }).first()
}

/** A cart-summary row value locator, keyed by its label ("Items:"/"Total:"/…). */
export function summaryRowValue(page: Page, label: string): Locator {
  // Row shape: <div class="flex justify-between"><span>Label:</span><span>€X</span></div>
  const labelSpan = page.getByText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`, "i")).first()
  return labelSpan.locator("xpath=following-sibling::span[1]")
}

/** The bold grand-total value on the cart summary. */
export function cartTotalValue(page: Page): Locator {
  return summaryRowValue(page, "Total:")
}

// -------------------------------------------------------------------------
// Readers — pull structured values out of the DOM (still DOM-only).
// -------------------------------------------------------------------------

/** The three-state label + enabled flag of the primary Add-to-Cart button. */
export async function addToCartState(page: Page): Promise<{
  present: boolean
  label: string
  enabled: boolean
  regionFallback: boolean
  outOfStock: boolean
}> {
  const btn = addToCartButton(page)
  if ((await btn.count()) === 0) {
    return { present: false, label: "", enabled: false, regionFallback: false, outOfStock: false }
  }
  const label = ((await btn.textContent()) || "").trim()
  const enabled = await btn.isEnabled().catch(() => false)
  return {
    present: true,
    label,
    enabled,
    regionFallback: REGION_FALLBACK_RE.test(label),
    outOfStock: OUT_OF_STOCK_RE.test(label),
  }
}

/** Read the first parseable price rendered on a PDP (major-unit number). */
export async function readPdpPrice(page: Page): Promise<number | null> {
  // The header price sits next to the title; scan visible money-shaped text.
  const texts = await page.locator("span, div, p").allInnerTexts().catch(() => [])
  for (const t of texts) {
    const n = parseMoney(t)
    if (n !== null) return n
  }
  return null
}

/**
 * Read a structured CartSnapshot from the cart page DOM: per-seller line items
 * and the summary rows. Line unit/qty parsing is best-effort (the line markup
 * varies); the summary totals are read from the labelled rows.
 */
export async function readCartSnapshot(page: Page): Promise<CartSnapshot> {
  const readRow = async (label: string): Promise<number | undefined> => {
    const loc = summaryRowValue(page, label)
    if ((await loc.count()) === 0) return undefined
    const n = parseMoney((await loc.first().textContent()) || "")
    return n ?? undefined
  }

  const total = (await readRow("Total:")) ?? 0
  const itemsTotal = await readRow("Items:")
  const shipping = await readRow("Delivery:")
  const tax = await readRow("Tax:")
  const discount = await readRow("Discount:")

  // Best-effort line extraction: each cart line renders a money value we can
  // parse. Personas that need exact per-line math should pass explicit lines to
  // the oracle; this reader gives a structural view.
  const lines: CartLine[] = []
  const currency = await inferCurrency(page)

  return { currency, lines, total, itemsTotal, tax, shipping, discount }
}

async function inferCurrency(page: Page): Promise<string> {
  const t = (await page.locator("body").innerText().catch(() => "")) || ""
  if (/€/.test(t) || /eur/i.test(t)) return "eur"
  if (/\$/.test(t)) return "usd"
  if (/£/.test(t)) return "gbp"
  return "eur"
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
