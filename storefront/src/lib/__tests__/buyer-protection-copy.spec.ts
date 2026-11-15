import { readdirSync, readFileSync, statSync } from "fs"
import path from "path"

import { describe, expect, it } from "vitest"

/**
 * `/buyer-protection` may promise only what the claim mechanism does.
 *
 * It once told buyers to "attach a photo, a tracking screenshot" to a form
 * with no upload, and "we'll come back to you rather than closing it
 * silently" while nothing sent a buyer their claim's outcome or showed it on
 * any page. These checks read the page and the code behind it as text, so a
 * promise and its mechanism have to arrive together.
 */

const src = path.join(__dirname, "../..")
const read = (relative: string) => readFileSync(path.join(src, relative), "utf8")

/** The page without its comments: what a buyer can read, not notes about it. */
const page = read("app/[locale]/(main)/buyer-protection/page.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
const claimForm = read("components/sections/OrderClaimSection/OrderClaimSection.tsx")

/** Every non-test source file that calls `name(`, other than where it is defined. */
function callersOf(name: string, definedIn: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules" && entry !== "__tests__") walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry) || /\.(spec|test)\.tsx?$/.test(entry)) continue
      if (path.relative(src, full) === definedIn) continue
      if (new RegExp(`\\b${name}\\(`).test(readFileSync(full, "utf8"))) out.push(path.relative(src, full))
    }
  }
  walk(src)

  return out
}

describe("/buyer-protection says only what the claim mechanism does", () => {
  it("still describes the claim and its review (so the checks below are not vacuous)", () => {
    expect(page).toMatch(/Open a claim/)
    expect(page).toMatch(/A person reads it/)
  })

  it("invites attachments only if the claim form takes a file", () => {
    const formTakesFiles = /type=["{]*file/.test(claimForm)
    if (!formTakesFiles) {
      expect(page).not.toMatch(/\battach/i)
      expect(page).not.toMatch(/screenshot/i)
    }
  })

  it("promises a reply only if something shows or sends the buyer the outcome", () => {
    const outcomeShown = callersOf("listOrderClaims", "lib/data/order-claims.ts").length > 0
    if (!outcomeShown) {
      expect(page).not.toMatch(/come back to you/i)
      expect(page).not.toMatch(/closing it silently/i)
      expect(page).not.toMatch(/we('|&apos;)ll (contact|reply to|update|get back to) you/i)
    }
  })
})
