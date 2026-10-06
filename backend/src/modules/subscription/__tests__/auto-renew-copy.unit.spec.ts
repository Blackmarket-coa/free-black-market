/**
 * The auto-renewal copy the backend renders (the Blackout hosted checkout) is
 * the storefront's copy, string for string. The operator approved the
 * storefront text as written (2026-10-05); a reworded backend copy would be an
 * unapproved disclosure, and an approval recorded against a version whose text
 * differs between the two places would not say what the member saw.
 *
 * Runs the storefront module itself (pure TS, no imports) rather than reading
 * it as text, so a change in either function body fails here.
 */
import fs from "fs"
import path from "path"
import {
  AUTO_RENEW_CHECKBOX_LABEL,
  autoRenewDisclosure,
  intervalNoun,
  oneTimeTerms,
} from "../utils/auto-renew-copy"
import { AUTO_RENEW_DISCLOSURE_VERSION } from "../utils/auto-renew"
import { SubscriptionInterval } from "../types"

const STOREFRONT_COPY = path.resolve(
  __dirname,
  "../../../../../storefront/src/lib/subscriptions/auto-renew.ts"
)

type StorefrontCopy = {
  AUTO_RENEW_DISCLOSURE_VERSION: string
  AUTO_RENEW_CHECKBOX_LABEL: string
  SUBSCRIPTION_INTERVALS: readonly string[]
  intervalNoun: (interval: string) => string
  autoRenewDisclosure: (input: { price: string; interval: string }) => string
  oneTimeTerms: (input: { price: string; interval: string }) => string
}

function loadStorefront(): StorefrontCopy | null {
  if (!fs.existsSync(STOREFRONT_COPY)) {
    // The backend is sometimes checked out on its own; in CI the whole repo
    // is there and a missing file must fail, never pass by skipping.
    if (process.env.CI) throw new Error(`storefront copy not found at ${STOREFRONT_COPY}`)
    return null
  }
  return jest.requireActual(STOREFRONT_COPY) as StorefrontCopy
}

const INTERVALS = Object.values(SubscriptionInterval)
const PRICES = ["$5.00", "$10.00", "€7,50", "12.34 CAD"]

describe("auto-renew copy: backend is the storefront's text", () => {
  const storefront = loadStorefront()
  const run = storefront ? it : it.skip

  run("carries the same disclosure version", () => {
    expect(AUTO_RENEW_DISCLOSURE_VERSION).toBe(storefront!.AUTO_RENEW_DISCLOSURE_VERSION)
  })

  run("has the same checkbox label", () => {
    expect(AUTO_RENEW_CHECKBOX_LABEL).toBe(storefront!.AUTO_RENEW_CHECKBOX_LABEL)
  })

  run("covers exactly the storefront's intervals", () => {
    expect([...INTERVALS].sort()).toEqual([...storefront!.SUBSCRIPTION_INTERVALS].sort())
  })

  run("is string-identical for every interval and price", () => {
    for (const interval of INTERVALS) {
      expect(intervalNoun(interval)).toBe(storefront!.intervalNoun(interval))
      for (const price of PRICES) {
        expect(autoRenewDisclosure({ price, interval })).toBe(
          storefront!.autoRenewDisclosure({ price, interval })
        )
        expect(oneTimeTerms({ price, interval })).toBe(storefront!.oneTimeTerms({ price, interval }))
      }
    }
  })

  it("names the price and the interval it is given", () => {
    const text = autoRenewDisclosure({ price: "$5.00", interval: SubscriptionInterval.MONTHLY })
    expect(text).toContain("$5.00 is charged")
    expect(text).toContain("renews every month until you cancel")
    expect(oneTimeTerms({ price: "$5.00", interval: SubscriptionInterval.YEARLY })).toBe(
      "Without automatic renewal you pay $5.00 once for one year, and nothing charges you again unless you choose to."
    )
  })
})
