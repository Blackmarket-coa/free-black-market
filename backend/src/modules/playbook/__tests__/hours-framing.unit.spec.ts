import { readFileSync } from "fs"
import { join } from "path"

import { PLAYBOOK_RECIPES } from "../recipes"
import { RAIL_REGISTRY, CLOSED_LOOP_RAILS } from "../../hawala-ledger/rails"

/**
 * Honest hours copy (`docs/CDFI_COOP_ROADMAP.md` §3.10, Tier A item 6).
 *
 * The HRS rail is closed-loop, not cash-convertible, and settles labour
 * between members of a collective; `dual-rail-selector.ts` throws rather than
 * let an hour settle a purchase. It is also not lit — nothing provisions a
 * `TIME_BANK` account or posts an opening balance. So no vendor-facing
 * surface may offer hours as a currency, a balance to build, or a way to pay
 * for goods. These assertions fail if that copy comes back.
 */

const STOREFRONT_VENDOR_TYPES = join(
  __dirname,
  "../../../../../storefront/src/app/[locale]/(main)/vendor-types/page.tsx"
)
const PANEL_PATHWAYS = join(
  __dirname,
  "../../../../../vendor-panel/src/components/playbook/playbook-picker/resource-pathways.ts"
)

/** Phrases that promise a spendable balance or a platform-run time bank. */
const OVERPROMISES = [
  "internal scrip",
  "bank your hours",
  "earn time credits",
  "time-bank service",
]

/**
 * Strip `//` and block comments before scanning: these files explain in
 * comments which phrases were removed and why, and that prose must not
 * itself trip the guard.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

const containsAny = (haystack: string, needles: string[]) =>
  needles.filter((n) => haystack.toLowerCase().includes(n.toLowerCase()))

describe("hours framing — what the rail actually permits", () => {
  it("keeps the HRS rail closed-loop and never cash-convertible", () => {
    const hrs = RAIL_REGISTRY.HRS
    expect(hrs.cash_convertible).toBe(false)
    expect(hrs.account_type).toBe("TIME_BANK")
    expect(hrs.unit).toBe("HRS")
    expect(CLOSED_LOOP_RAILS.has("HRS")).toBe(true)
  })

  it("no playbook recipe promises scrip or a platform-run time bank", () => {
    for (const recipe of Object.values(PLAYBOOK_RECIPES)) {
      const found = containsAny(recipe.social_form, OVERPROMISES)
      expect({ id: recipe.id, found }).toEqual({ id: recipe.id, found: [] })
    }
  })

  it("the Service and Grove recipes still describe hours, just honestly", () => {
    expect(PLAYBOOK_RECIPES.service.social_form).toMatch(/member-to-member time-banking/i)
    expect(PLAYBOOK_RECIPES.grove.social_form).toMatch(/member-to-member hour-sharing/i)
  })

  it("the public vendor-types page makes no scrip or spendable-hours promise", () => {
    const page = codeOnly(readFileSync(STOREFRONT_VENDOR_TYPES, "utf8"))
    expect(containsAny(page, OVERPROMISES)).toEqual([])
    // And it says plainly that hours are not checkout tender.
    expect(page).toMatch(/hours never pay for goods at checkout/i)
    expect(page).toMatch(/never pays for goods/i)
  })

  it("the vendor-panel time pathway offers logging, not a balance", () => {
    const pathways = codeOnly(readFileSync(PANEL_PATHWAYS, "utf8"))
    expect(containsAny(pathways, OVERPROMISES)).toEqual([])
    expect(pathways).toMatch(/they never buy goods/i)
  })
})
