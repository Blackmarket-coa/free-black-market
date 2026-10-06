import { SubscriptionInterval } from "../types"

/**
 * The purchase-time auto-renewal copy, for pages the backend renders itself
 * (the Blackout hosted checkout, commerce/checkout/sessions/[token]/page).
 *
 * The storefront shows the same checkbox and disclosure next to its subscribe
 * form (storefront/src/lib/subscriptions/auto-renew.ts). The operator approved
 * that text as written (2026-10-05, version AUTO_RENEW_DISCLOSURE_VERSION), so
 * this file is a copy, never a rewording: `__tests__/auto-renew-copy.unit.spec.ts`
 * runs both and fails unless every string is identical for the same inputs,
 * including the version. Change the text on one side → change it on both,
 * and bump AUTO_RENEW_DISCLOSURE_VERSION on both (utils/auto-renew.ts here).
 *
 * Pure: no container.
 */

const INTERVAL_NOUN: Record<SubscriptionInterval, string> = {
  [SubscriptionInterval.WEEKLY]: "week",
  [SubscriptionInterval.BIWEEKLY]: "two weeks",
  [SubscriptionInterval.MONTHLY]: "month",
  [SubscriptionInterval.QUARTERLY]: "three months",
  [SubscriptionInterval.YEARLY]: "year",
}

export const intervalNoun = (interval: SubscriptionInterval): string => INTERVAL_NOUN[interval]

export type DisclosureInput = {
  /** Formatted price per interval, e.g. "$10.00". */
  price: string
  interval: SubscriptionInterval
}

/** Label of the (unticked by default) approval checkbox. */
export const AUTO_RENEW_CHECKBOX_LABEL = "Renew automatically until I cancel"

/** The auto-renewal disclosure shown next to the approval checkbox. */
export function autoRenewDisclosure({ price, interval }: DisclosureInput): string {
  const noun = intervalNoun(interval)
  return (
    `This is a subscription — if you tick this box, it renews every ${noun} until you cancel. ` +
    `${price} is charged to the card you pay with today at the start of each new ${noun}, ` +
    `and that card is saved so these renewals can be charged. ` +
    `You can turn off automatic renewal or cancel at any time under Account → Subscriptions; ` +
    `turning it off stops future charges and you keep access until the end of the ${noun} you have paid for.`
  )
}

/** What the customer gets when they leave the box unticked. */
export function oneTimeTerms({ price, interval }: DisclosureInput): string {
  const noun = intervalNoun(interval)
  return (
    `Without automatic renewal you pay ${price} once for one ${noun}, ` +
    `and nothing charges you again unless you choose to.`
  )
}
