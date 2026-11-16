import { readdirSync, readFileSync, statSync } from "fs"
import path from "path"

import { describe, expect, it } from "vitest"

/**
 * `/buyer-protection` may promise only what the claim mechanism does.
 *
 * It once told buyers to "attach a photo, a tracking screenshot" to a form
 * with no upload, "we'll come back to you rather than closing it silently"
 * while nothing sent a buyer their claim's outcome or showed it on any page,
 * and "a person reads it" while nothing told an operator a claim had arrived.
 * These checks read the page and the code behind it (the backend's too) as
 * text, so a promise and its mechanism have to arrive together.
 */

const src = path.join(__dirname, "../..")
const read = (relative: string) => readFileSync(path.join(src, relative), "utf8")

/** The page without its comments: what a buyer can read, not notes about it. */
const page = read("app/[locale]/(main)/buyer-protection/page.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
const claimForm = read("components/sections/OrderClaimSection/OrderClaimSection.tsx")

/** Backend source, read as text: a separate workspace, not a dependency. */
const backendDir = path.join(src, "../../backend/src")
const backend = (relative: string) => readFileSync(path.join(backendDir, relative), "utf8")

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
    expect(page).toMatch(/review queue/)
  })

  it("says a person reads each claim only if something tells an operator one arrived", () => {
    // A claim becomes an order dispute and waits in the admin Disputes queue.
    // Nothing notifies anyone on intake: no subscriber touches order
    // disputes, and the intake sends nothing.
    const subscribersDir = path.join(backendDir, "subscribers")
    const subscriberNotices = readdirSync(subscribersDir)
      .filter((f) => /\.ts$/.test(f))
      .some((f) => /order[-_]?dispute|ORDER_DISPUTE_MODULE/i.test(readFileSync(path.join(subscribersDir, f), "utf8")))
    const intakeNotices = /notif|sendEmail|createNotifications/i.test(backend("shared/order-dispute-intake.ts"))
    if (!subscriberNotices && !intakeNotices) {
      expect(page).not.toMatch(/a person reads/i)
      expect(page).not.toMatch(/someone (reads|reviews|looks at) (it|your claim)/i)
    }
  })

  /**
   * The note is the reason both parties read in their claim records. Only
   * the admin panel used to ask for it; any other caller of the PATCH could
   * close a case without one. The page may promise a written reason while
   * the server refuses a closing decision without a note.
   */
  it("promises a written reason for every decision only while the server refuses one without it", () => {
    if (!/written reason/i.test(page)) return

    const patchRoute = backend("api/admin/disputes/[id]/route.ts")
    const resolution = backend("modules/order-dispute/resolution.ts")
    // The check runs on the PATCH and answers 400.
    expect(patchRoute).toMatch(
      /if \(decisionNoteMissing\(status, body\.note\)\) \{\s*return res\.status\(400\)/
    )
    // And it covers every decision that closes a case.
    const listed = resolution.match(/export const DECISIONS_NEEDING_A_NOTE[^=]*=\s*\[([\s\S]*?)\]/)
    expect(listed).not.toBeNull()
    expect([...listed![1].matchAll(/DisputeStatus\.(\w+)/g)].map((m) => m[1]).sort()).toEqual([
      "RESOLVED_REFUND",
      "RESOLVED_RELEASE",
      "WITHDRAWN",
    ])
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
      // "An explanation of why we can't act" reads as one the buyer receives;
      // the reason is recorded on the claim, and no page or email shows it yet.
      expect(page).not.toMatch(/\bexplanation\b/i)
      expect(page).not.toMatch(/we('|&apos;)ll (explain|tell you)/i)
    }
  })

  /**
   * A decision is a refund, a release (the seller keeps the money) or a
   * withdrawal. Step 4 once offered "a replacement", which no decision
   * records and nothing arranges.
   */
  it("offers only the outcomes a decision can record", () => {
    const statuses = backend("modules/order-dispute/resolution.ts").match(/export enum DisputeStatus \{([\s\S]*?)\n\}/)
    expect(statuses).not.toBeNull()
    expect(statuses![1]).toMatch(/RESOLVED_REFUND/)
    if (!/REPLACE/i.test(statuses![1])) {
      expect(page).not.toMatch(/replacement|replace it/i)
    }
  })
})
