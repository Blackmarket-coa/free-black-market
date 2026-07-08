/**
 * comparison-shopper.spec.ts — DOM-only persona (Tier 1, persona #2).
 *
 * GOAL: open ≥3 PDPs across ≥2 vendors, add one unit each, then assert every cart
 * line attributes to the SAME vendor it was sold by on its PDP and that the line
 * totals sum to the cart's items subtotal — i.e. buyer-side multi-vendor isolation.
 *
 * DOM-ONLY, non-negotiable: this persona uses ONLY `page` (via the `agent`
 * fixture) — never Playwright's `request` context, never a /store|/admin|/vendor
 * HTTP client, and it NEVER imports ../lib/differential (harness-only). Vendor
 * identity is learned the way a shopper learns it: by reading the `/sellers/…`
 * link the storefront renders on the PDP, then matching it against the seller
 * group the cart renders the line under.
 *
 * Attribution key (both surfaces expose it in the DOM):
 *   PDP  — ProductDetailsSeller → <a href="/{cc}/sellers/{handle}">{name}</a>
 *   cart — CartItemsHeader      → <a href="/{cc}/sellers/{handle}">{NAME}</a> per group,
 *          each group's lines = <div class="border rounded-sm p-1"> (h3 title + € total).
 */

import { existsSync } from "fs"
import { test, expect } from "../lib/persona"
import {
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
  addToCartState,
  readPdpPrice,
  pdpTitle,
  summaryRowValue,
} from "../lib/selectors"
import { parseMoney, type CartLine, type CartSnapshot } from "../lib/oracle"

/** What we learned about one product from its PDP (DOM-only). */
interface Captured {
  url: string
  handle: string
  title: string
  sellerHandle: string | null
  sellerName: string | null
  pdpPrice: number | null
  canAdd: boolean
  atcLabel: string
}

/** One cart line as read from the cart DOM. */
interface LineSnap {
  title: string
  lineTotal: number | null
}

/** One seller group as read from the cart DOM. */
interface GroupSnap {
  sellerHandle: string | null
  sellerName: string | null
  lines: LineSnap[]
}

type Phase = "boot" | "collect" | "shop" | "verify" | "done"

export class ComparisonShopper extends Persona {
  readonly name = "comparison-shopper"
  readonly goal =
    "open ≥3 PDPs across ≥2 vendors, add one each, and assert every cart line " +
    "attributes to the correct vendor and the line totals sum"

  // ---- policy state (fresh per run; one instance per test) ----
  private phase: Phase = "boot"
  private queue: string[] = [] // PDP hrefs still to visit
  private readonly handled = new Set<string>() // PDP handles already queued/visited
  private visitCount = 0
  private readonly added: Captured[] = []
  private readonly skipped: { href: string; reason: string }[] = []

  private readonly maxVisit = 6
  private readonly wantProducts = 3
  private readonly wantVendors = 2

  private get cc(): string {
    return this.options.countryCode
  }
  private get cartPath(): string {
    return `/${this.cc}/cart`
  }

  // -------------------------------------------------------------------------
  // The policy: perceive → decide. Reads are DOM-only; page mutations happen
  // inside the returned Action's perform (still page-only).
  // -------------------------------------------------------------------------
  async decide(p: Percept, _m: PersonaMemory): Promise<Action> {
    try {
      const url = p.url

      // BOOT — land on the storefront listing for the configured country.
      if (this.phase === "boot") {
        this.phase = "collect"
        return act(`open storefront listing (/${this.cc})`, async (page) => {
          await page.goto(`/${this.cc}`)
        })
      }

      // COLLECT — harvest product links, then head to the first PDP.
      if (this.phase === "collect") {
        await this.collect()
        if (this.queue.length === 0) {
          this.verdict.note(
            "no product links found on the listing; cannot exercise a multi-vendor cart"
          )
          this.phase = "done"
          return giveUp("no products to compare")
        }
        this.phase = "shop"
        return act("open first PDP", async (page) => {
          await page.goto(this.nextDestination())
        })
      }

      // SHOP — on a PDP: capture the seller + title, add one unit, move on.
      if (this.phase === "shop") {
        if (/\/products\//.test(url)) {
          // Fast-skip a 500 PDP: the reachability blocker is already auto-logged by
          // observe(); doing the (element-waiting) capturePdp read on a broken error
          // page would just burn the per-action timeout budget. Record it as a
          // skipped-because-500 and advance immediately.
          if (p.hasServerError) {
            this.skipped.push({ href: url, reason: "PDP returned HTTP 500 (server error)" })
            const dest = this.nextDestination()
            return act(`skip 500 PDP → ${this.short(dest)}`, async (page) => {
              await page.goto(dest)
            })
          }
          const cap = await this.capturePdp()
          if (cap.canAdd) {
            this.added.push(cap)
            const dest = this.nextDestination()
            return act(`add "${cap.title}" to cart → ${this.short(dest)}`, async (page) => {
              await addToCartButton(page)
                .click({ timeout: 15_000 })
                .catch(() => {
                  /* a broken add-to-cart surfaces later as an absent cart line */
                })
              await this.settle(page)
              await page.goto(dest)
            })
          }
          // region-fallback / out-of-stock / no button → skip and advance.
          this.skipped.push({ href: cap.url, reason: cap.atcLabel || "add-to-cart unavailable" })
          const dest = this.nextDestination()
          return act(
            `skip "${cap.title}" (${cap.atcLabel || "unavailable"}) → ${this.short(dest)}`,
            async (page) => {
              await page.goto(dest)
            }
          )
        }
        // Arrived somewhere that isn't a PDP.
        if (/\/cart/.test(url)) {
          this.phase = "verify"
          return act("begin cart verification", async () => {
            /* no-op: verify runs next step with a settled cart DOM */
          })
        }
        return act("navigate to next target", async (page) => {
          await page.goto(this.nextDestination())
        })
      }

      // VERIFY — on the cart: read groups, assert attribution + totals, finish.
      if (this.phase === "verify") {
        if (!/\/cart/.test(url)) {
          return act("go to cart", async (page) => {
            await page.goto(this.cartPath)
          })
        }
        await this.verifyCart()
        this.phase = "done"
        return DONE
      }

      return DONE
    } catch (e) {
      // Never let the policy throw the run into "error"; record and stop clean.
      this.verdict.note(`decide() handled exception: ${String(e)}`)
      return giveUp("decide error handled")
    }
  }

  // -------------------------------------------------------------------------
  // Navigation planning
  // -------------------------------------------------------------------------

  /** True once we have enough coverage or have exhausted our visit budget. */
  private shouldStop(): boolean {
    return (
      this.visitCount >= this.maxVisit ||
      (this.added.length >= this.wantProducts && this.distinctVendors() >= this.wantVendors)
    )
  }

  /** Next PDP href to visit, or the cart path when we should stop shopping. */
  private nextDestination(): string {
    if (this.shouldStop()) return this.cartPath
    while (this.queue.length) {
      const href = this.queue.shift()!
      const handle = this.handleOf(href)
      if (!handle || this.handled.has(handle)) continue
      this.handled.add(handle)
      this.visitCount++
      return href
    }
    return this.cartPath
  }

  // -------------------------------------------------------------------------
  // DOM readers (page-only)
  // -------------------------------------------------------------------------

  /** Harvest unique product links from the current listing into the queue. */
  private async collect(): Promise<void> {
    const raw = await productLinks(this.page)
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") || ""))
      .catch(() => [] as string[])
    const seen = new Set<string>()
    for (const href of raw) {
      const handle = this.handleOf(href)
      if (!handle || seen.has(handle)) continue
      seen.add(handle)
      this.queue.push(href)
    }
  }

  /** Read the current PDP: title, seller (handle+name from the /sellers link), ATC state. */
  private async capturePdp(): Promise<Captured> {
    const page = this.page
    const url = page.url()
    const handle = this.handleOf(url) || url
    const title = ((await pdpTitle(page).textContent().catch(() => "")) || "").trim()

    let sellerHandle: string | null = null
    let sellerName: string | null = null
    const sellerLink = page.locator('a[href*="/sellers/"]').first()
    if ((await sellerLink.count().catch(() => 0)) > 0) {
      const href = await sellerLink.getAttribute("href").catch(() => null)
      sellerHandle = this.sellerHandleOf(href)
      const raw = ((await sellerLink.innerText().catch(() => "")) || "").trim()
      sellerName = raw ? raw.split("\n")[0].trim() : null
    }

    const atc = await addToCartState(page)
    const pdpPrice = await readPdpPrice(page).catch(() => null)
    const canAdd = atc.present && atc.enabled && !atc.regionFallback && !atc.outOfStock

    return { url, handle, title, sellerHandle, sellerName, pdpPrice, canAdd, atcLabel: atc.label }
  }

  /** Read the cart's per-seller groups and their line items (title + € total). */
  private async readCartGroups(): Promise<GroupSnap[]> {
    const page = this.page
    const headers = page.locator('a[href*="/sellers/"]')
    const n = await headers.count().catch(() => 0)
    const groups: GroupSnap[] = []

    for (let i = 0; i < n; i++) {
      const h = headers.nth(i)
      // The group wrapper is the seller link's nearest ancestor <div class="mb-4">.
      const group = h.locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " mb-4 ")][1]'
      )
      if ((await group.count().catch(() => 0)) === 0) continue

      // Cart line items render as div.border.rounded-sm.p-1 (header/footer are p-4).
      const lineDivs = group.locator("div.border.rounded-sm.p-1")
      const lc = await lineDivs.count().catch(() => 0)
      if (lc === 0) continue // not a product group (e.g. a nav /sellers link)

      const sellerHandle = this.sellerHandleOf(await h.getAttribute("href").catch(() => null))
      const rawName = ((await h.innerText().catch(() => "")) || "").trim()
      const sellerName = rawName ? rawName.split("\n")[0].trim() : null

      const lines: LineSnap[] = []
      for (let j = 0; j < lc; j++) {
        const ld = lineDivs.nth(j)
        const title = ((await ld.locator("h3").first().innerText().catch(() => "")) || "").trim()
        const txt = ((await ld.innerText().catch(() => "")) || "")
        const m = txt.match(/[€$£]\s?-?\d[\d.,]*/)
        lines.push({ title, lineTotal: m ? parseMoney(m[0]) : null })
      }
      groups.push({ sellerHandle, sellerName, lines })
    }
    return groups
  }

  /** Parse a labelled cart-summary row ("Items:"/"Total:"/…) to major units. */
  private async readSummary(label: string): Promise<number | undefined> {
    const loc = summaryRowValue(this.page, label)
    if ((await loc.count().catch(() => 0)) === 0) return undefined
    const n = parseMoney((await loc.first().textContent().catch(() => "")) || "")
    return n ?? undefined
  }

  private async inferCurrency(): Promise<string> {
    const t = (await this.page.locator("body").innerText().catch(() => "")) || ""
    if (/€/.test(t) || /eur/i.test(t)) return "eur"
    if (/\$/.test(t)) return "usd"
    if (/£/.test(t)) return "gbp"
    return "eur"
  }

  // -------------------------------------------------------------------------
  // The verification — this is where the persona's invariants are asserted.
  // -------------------------------------------------------------------------
  private async verifyCart(): Promise<void> {
    if (this.added.length === 0) {
      this.verdict.note(
        "no items were addable (region fallback / out-of-stock / PDP errors); " +
          "the multi-vendor cart could not be exercised"
      )
      return
    }

    const groups = await this.readCartGroups()
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase()
    const addedTitles = this.added.map((a) => norm(a.title)).filter(Boolean)

    const findLine = (title: string): { g: GroupSnap; line: LineSnap }[] => {
      const t = norm(title)
      const hits: { g: GroupSnap; line: LineSnap }[] = []
      for (const g of groups) {
        for (const line of g.lines) {
          const ct = norm(line.title)
          if (ct && (ct === t || ct.includes(t) || t.includes(ct))) hits.push({ g, line })
        }
      }
      return hits
    }

    // --- Invariant 1: each added line attributes to the vendor that sold it. ---
    for (const a of this.added) {
      const hits = findLine(a.title)

      if (hits.length === 0) {
        // Added on the PDP but not in the cart → add-to-cart did not persist.
        this.verdict.divergence({
          source: "persona",
          severity: "blocker",
          invariant: "added-item-present-in-cart",
          location: this.cartPath,
          failureScenario:
            `added "${a.title}" (seller ${a.sellerName ?? a.sellerHandle ?? "unknown"}) on its ` +
            `PDP but it is ABSENT from the cart — the line did not persist ` +
            `(cart-creation / line-add failure; cf. BUG-01 cart POST 500)`,
          evidence: {
            title: a.title,
            pdp: a.url,
            sellerHandle: a.sellerHandle,
            sellerName: a.sellerName,
          },
        })
        continue
      }

      if (hits.length > 1) {
        this.verdict.divergence({
          source: "persona",
          severity: "major",
          invariant: "cart-line-single-vendor",
          location: this.cartPath,
          failureScenario:
            `"${a.title}" appears under ${hits.length} seller groups in the cart — ` +
            `a line must belong to exactly one vendor`,
          evidence: { title: a.title, groups: hits.map((h) => h.g.sellerName) },
        })
      }

      const g = hits[0].g
      if (a.sellerHandle) {
        const handleMatch = !!g.sellerHandle && g.sellerHandle === a.sellerHandle
        const nameMatch = this.namesMatch(g.sellerName, a.sellerName)
        if (!handleMatch && !nameMatch) {
          this.verdict.divergence({
            source: "persona",
            severity: "major",
            invariant: "cart-line-attributes-to-correct-vendor",
            location: this.cartPath,
            failureScenario:
              `"${a.title}" was sold by "${a.sellerName ?? a.sellerHandle}" ` +
              `(/sellers/${a.sellerHandle}) on its PDP, but the cart attributes it to ` +
              `"${g.sellerName ?? g.sellerHandle}" (/sellers/${g.sellerHandle}) — ` +
              `buyer-side multi-vendor MISATTRIBUTION (vendor-isolation defect)`,
            evidence: {
              title: a.title,
              pdpSeller: { handle: a.sellerHandle, name: a.sellerName },
              cartSeller: { handle: g.sellerHandle, name: g.sellerName },
            },
          })
        } else {
          this.verdict.verifiedClean(
            "vendor-attribution",
            `"${a.title}" correctly attributes to ${a.sellerName ?? a.sellerHandle} in the cart`
          )
        }
      } else {
        // The PDP exposed no seller (guest fleek fallback) → expect the Fleek group.
        const isFleek =
          !g.sellerHandle || g.sellerHandle === "undefined" || this.namesMatch(g.sellerName, "Fleek")
        if (!isFleek) {
          this.verdict.divergence({
            source: "persona",
            severity: "minor",
            invariant: "cart-line-attributes-to-correct-vendor",
            location: this.cartPath,
            failureScenario:
              `"${a.title}" exposed no seller on its PDP, yet the cart attributes it to named ` +
              `vendor "${g.sellerName ?? g.sellerHandle}" — unexpected buyer-side attribution`,
            evidence: { title: a.title, cartSeller: { handle: g.sellerHandle, name: g.sellerName } },
          })
        } else {
          this.verdict.verifiedClean(
            "vendor-attribution",
            `"${a.title}" (no PDP seller) grouped under the Fleek fallback as expected`
          )
        }
      }
    }

    // --- Invariant 2 (isolation refinement): cart shows only what we added. ---
    for (const g of groups) {
      for (const line of g.lines) {
        const ct = norm(line.title)
        if (!ct) continue
        const known = addedTitles.some((t) => ct.includes(t) || t.includes(ct))
        if (!known) {
          this.verdict.divergence({
            source: "persona",
            severity: "minor",
            invariant: "cart-contains-only-added-items",
            location: this.cartPath,
            failureScenario:
              `cart shows line "${line.title}" under "${g.sellerName ?? g.sellerHandle}" that ` +
              `this persona never added — unexpected cart contents`,
            evidence: { line: line.title, seller: g.sellerName },
          })
        }
      }
    }

    // --- Invariant 3: totals sum — Σ line totals == items subtotal + reconcile. ---
    const lines: CartLine[] = []
    let missingMoney = false
    for (const g of groups) {
      for (const line of g.lines) {
        if (line.lineTotal == null) {
          missingMoney = true
          continue
        }
        lines.push({
          title: line.title,
          vendor: g.sellerName ?? undefined,
          quantity: 1,
          lineTotal: line.lineTotal,
        })
      }
    }
    const snap: CartSnapshot = {
      currency: await this.inferCurrency(),
      lines,
      itemsTotal: await this.readSummary("Items:"),
      tax: await this.readSummary("Tax:"),
      shipping: await this.readSummary("Delivery:"),
      discount: await this.readSummary("Discount:"),
      total: (await this.readSummary("Total:")) ?? 0,
    }

    if (lines.length > 0 && !missingMoney) {
      const r = this.oracle.cartTotalEqualsLineSum(snap)
      if (r.status === "fail") this.verdict.fromOracle(this.cartPath, r)
      else if (r.status === "pass") this.verdict.verifiedClean("totals", r.detail)
    } else {
      this.verdict.note(
        "totals-sum: skipped — per-line money not fully parseable from the cart DOM (no false green)"
      )
    }
    const rr = this.oracle.totalsReconcile(snap)
    if (rr.status === "fail") this.verdict.fromOracle(this.cartPath, rr)
    else if (rr.status === "pass") this.verdict.verifiedClean("totals-reconcile", rr.detail)

    // --- No-silent-caps: state coverage honestly. ---
    const dv = this.distinctVendors()
    if (this.added.length < this.wantProducts || dv < this.wantVendors) {
      this.verdict.note(
        `multi-vendor isolation only PARTIALLY exercised: ${this.added.length} item(s) across ` +
          `${dv} distinct vendor(s) (goal ≥${this.wantProducts} across ≥${this.wantVendors}); ` +
          `the seeded stack may be single-vendor / region-limited — no-silent-caps`
      )
    }
    if (this.skipped.length > 0) {
      this.verdict.note(
        `${this.skipped.length} PDP(s) skipped (region fallback / out-of-stock / no add button)`
      )
    }
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  private distinctVendors(): number {
    const keys = new Set(
      this.added.map((a) =>
        a.sellerHandle ? `h:${a.sellerHandle}` : `n:${(a.sellerName || "fleek").toUpperCase()}`
      )
    )
    return keys.size
  }

  private namesMatch(a: string | null, b: string | null): boolean {
    if (!a || !b) return false
    const A = a.replace(/\s+/g, " ").trim().toUpperCase()
    const B = b.replace(/\s+/g, " ").trim().toUpperCase()
    if (!A || !B) return false
    return A === B || A.includes(B) || B.includes(A)
  }

  private handleOf(href: string | null | undefined): string | null {
    if (!href) return null
    return href.match(/\/products\/([^/?#]+)/)?.[1] ?? null
  }

  private sellerHandleOf(href: string | null | undefined): string | null {
    if (!href) return null
    return href.match(/\/sellers\/([^/?#]+)/)?.[1] ?? null
  }

  private short(dest: string): string {
    return this.handleOf(dest) ?? (/\/cart/.test(dest) ? "cart" : dest)
  }

  private async settle(page: import("@playwright/test").Page): Promise<void> {
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {})
    await page
      .getByText(/added to cart/i)
      .first()
      .waitFor({ timeout: 4_000 })
      .catch(() => {})
  }
}

test("comparison shopper: cart lines attribute to the correct vendor and totals sum", async ({
  agent,
}, testInfo) => {
  const persona = new ComparisonShopper(agent, {
    testInfo,
    // Leads-not-failures: don't halt at the first reachability divergence (a 5xx
    // PDP) — keep visiting products so one run surfaces every lead it can reach.
    options: { stopOnOracleViolation: false },
  })
  const result = await persona.run()

  // Surface the headline + every ranked lead in the report, then emit the doc.
  persona.verdict.annotate(testInfo)
  const verdictPath = persona.verdict.write(testInfo.outputDir)

  // Leads-not-failures: the persona produces LEADS, not a
  // pass/fail gate. Every divergence — a vendor MISATTRIBUTION (this persona's
  // owned invariant) just as much as a reachability lead (5xx / region fallback /
  // cart-500) — is REPORTED as a ranked lead in the verdict doc (headline +
  // lead:* annotations), never asserted away. This spec asserts only that the
  // HARNESS ran correctly: a terminal StopReason with no unhandled throw and a
  // verdict doc emitted. instrument.spec.ts is the one spec that hard-asserts.
  expect(result.persona).toBe("comparison-shopper")
  expect(result.stop).not.toBe("error")
  expect(existsSync(verdictPath)).toBeTruthy()
})
