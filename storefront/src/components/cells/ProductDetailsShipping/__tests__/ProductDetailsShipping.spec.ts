import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { REFUNDS_POLICY_PATH } from "@/lib/constants/legal"

import { RETURNS_COPY, SHIPPING_COPY } from "../copy"

/**
 * The product page's Shipping & Returns section once promised free US shipping
 * and a 30-day return "for the chair" on every shippable listing: starter-kit
 * text FBM never offered, contradicting /legal/refunds. These checks fail if
 * a promise like that comes back.
 */
const source = readFileSync(path.resolve(__dirname, "../ProductDetailsShipping.tsx"), "utf8")
const refundsPage = readFileSync(
  path.resolve(__dirname, "../../../../app/[locale]/(main)/legal/refunds/page.tsx"),
  "utf8"
)

describe("ProductDetailsShipping", () => {
  it("makes no platform-wide shipping or returns promise", () => {
    const rendered = `${SHIPPING_COPY} ${RETURNS_COPY}`
    for (const promise of [/free (standard )?shipping/i, /\b\d+[- ]day return/i, /full refund/i, /\bchair\b/i, /continental u\.?s/i]) {
      expect(rendered).not.toMatch(promise)
    }
  })

  it("says what the refunds policy says: seller-set terms, none published means not returnable", () => {
    expect(RETURNS_COPY).toMatch(/each seller sets their own return terms/i)
    expect(RETURNS_COPY).toMatch(/not returnable/i)
    // The policy page this points at states the same rule; if it changes,
    // this copy has to be revisited with it.
    expect(refundsPage).toMatch(/Each seller sets their own/)
    expect(refundsPage).toMatch(/If a listing shows no return terms, treat the goods as not returnable/)
  })

  it("links the buyer to the refunds policy", () => {
    expect(REFUNDS_POLICY_PATH).toBe("/legal/refunds")
    expect(source).toMatch(/href=\{REFUNDS_POLICY_PATH\}/)
  })
})
