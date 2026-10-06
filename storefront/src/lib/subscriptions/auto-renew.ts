/**
 * Consumer subscriptions with affirmative auto-renew approval (Black Mask F2,
 * NEXT_PUBLIC_FF_CONSUMER_SUBSCRIPTIONS_V1 — the twin of the API's
 * FF_CONSUMER_SUBSCRIPTIONS_V1; set only together with it).
 *
 * The operator's rule (2026-10-05, "renew upon approval"): a subscription
 * renews until cancelled ONLY when the customer ticks the auto-renew box at
 * purchase. Unticked, they pay for exactly one period and nothing charges them
 * again. The backend enforces this; this module holds the copy the customer
 * sees and the small decisions the checkout makes from it.
 *
 * Pure — no React, no fetch — so every decision is unit-testable.
 *
 * Copy source. The repo had no full auto-renewal disclosure; the most
 * built-out renewal wording it had is the recurring-listing hint in
 * components/organisms/ProductDetails/ListingTypeInfo.tsx ("This is a
 * subscription — it renews on the seller's cadence until you cancel.") and the
 * add-on renewal promise on app/[locale]/(main)/transparency/page.tsx
 * ("nothing charges you again unless you choose to"). The text below keeps
 * those sentences, adapting only the nouns, and adds the facts a customer
 * needs to approve a recurring charge: the price, the interval, when the next
 * charge happens, and how to stop it.
 *
 * The Blackout hosted checkout (rendered by the backend) shows the same
 * checkbox label, disclosure and one-period terms from its own copy,
 * backend/src/modules/subscription/utils/auto-renew-copy.ts; the backend spec
 * modules/subscription/__tests__/auto-renew-copy.unit.spec.ts runs this file
 * and fails unless both are string-identical. Change the text here → change it
 * there in the same PR.
 */

/**
 * Version of the disclosure text below. Sent with every approval and stored on
 * the subscription; the backend refuses an approval of any other version
 * (backend/src/modules/subscription/utils/auto-renew.ts carries the same
 * value). Change the text → bump this on BOTH sides.
 */
export const AUTO_RENEW_DISCLOSURE_VERSION = "2026-10-05"

/**
 * Version of the RE-APPROVAL disclosure (`reapprovalDisclosure`, account page).
 * Its wording differs from the purchase disclosure — nothing is charged at
 * re-approval, the card already saved is charged at the paid-period end — so
 * it is versioned on its own; the backend's `approveAutoRenew` accepts only
 * this value (backend/src/modules/subscription/utils/auto-renew.ts).
 */
export const AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION = "2026-10-05.reapproval"

/** Product metadata marking a product that MAY be sold until cancelled. */
export const SUBSCRIBABLE_METADATA_KEY = "subscription_until_canceled"
/** Product metadata naming the billing interval the subscribe flow sells. */
export const SUBSCRIPTION_INTERVAL_METADATA_KEY = "subscription_interval"
/**
 * Product metadata overriding the grace length (backend
 * modules/subscription/utils/grace.ts, same key). The platform default
 * (SUBSCRIPTION_GRACE_PERIOD_DAYS) is backend-only and not visible here, so
 * without a product value the copy promises no grace at all — it can only
 * understate what the customer gets, never overstate it.
 */
export const GRACE_PERIOD_METADATA_KEY = "subscription_grace_period_days"

export const SUBSCRIPTION_INTERVALS = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
] as const
export type SubscriptionInterval = (typeof SUBSCRIPTION_INTERVALS)[number]

const INTERVAL_NOUN: Record<SubscriptionInterval, string> = {
  weekly: "week",
  biweekly: "two weeks",
  monthly: "month",
  quarterly: "three months",
  yearly: "year",
}

export const intervalNoun = (interval: SubscriptionInterval) => INTERVAL_NOUN[interval]

type ProductLike = { metadata?: Record<string, unknown> | null } | null | undefined

/**
 * The interval a product is sold on, when it is offered through the subscribe
 * flow at all: marked as subscribable AND naming a known interval. Anything
 * else (unmarked, no interval, an unknown interval) is null — the product page
 * then shows no subscribe button.
 */
export function subscribableInterval(product: ProductLike): SubscriptionInterval | null {
  const metadata = product?.metadata ?? null
  const marked =
    metadata?.[SUBSCRIBABLE_METADATA_KEY] === true ||
    metadata?.[SUBSCRIBABLE_METADATA_KEY] === "true"
  if (!marked) return null
  const raw = metadata?.[SUBSCRIPTION_INTERVAL_METADATA_KEY]
  return typeof raw === "string" &&
    (SUBSCRIPTION_INTERVALS as readonly string[]).includes(raw)
    ? (raw as SubscriptionInterval)
    : null
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

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

/**
 * The disclosure for turning automatic renewal back ON from the account page.
 * Not the purchase wording: nothing is charged now, and the charge falls on
 * the card already saved for this subscription at the end of the period
 * already paid for. `price` is the product's current price; the renewal
 * re-buys at the price current then.
 */
export function reapprovalDisclosure({
  price,
  interval,
  paidThrough,
}: DisclosureInput & { paidThrough: string }): string {
  const noun = intervalNoun(interval)
  return (
    `If you tick this box, this subscription renews every ${noun} until you cancel. ` +
    `Nothing is charged today. The card already saved for this subscription is charged ` +
    `the current price (${price}) on ${paidThrough}, and again at the start of each ${noun} after that. ` +
    `You can turn off automatic renewal or cancel at any time under Account → Subscriptions.`
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

/** Cancel-anytime terms. */
export const CANCEL_ANYTIME_TERMS =
  "Cancel any time under Account → Subscriptions. Cancelling stops all future charges."

/**
 * A configured grace length in whole days, or null (mirrors the backend's
 * `parseGraceDays`: a non-negative integer, as a number or numeric string).
 */
export function parseGraceDays(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 ? raw : null
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim())
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

/** The product's own grace length, when it sets one. */
export const graceDaysOf = (product: ProductLike): number | null =>
  parseGraceDays(product?.metadata?.[GRACE_PERIOD_METADATA_KEY])

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`

/**
 * What cancelling, turning renewal off and a failed payment do to access, in
 * plain words — only what the backend actually does:
 *
 *   - always: turning renewal off keeps access to the end of the paid period
 *     (`withdrawAutoRenew`); cancelling may end it sooner (with no grace
 *     length, a cancel ends the subscription and revokes access at once);
 *   - only with a grace length the page can see (the product's): a cancel of
 *     a renewing subscription keeps access through the paid period plus that
 *     grace, and failed renewals get that grace and one final charge before
 *     the subscription becomes read-only.
 *
 * Nothing here promises sign-in or export in read-only: enforcing read-only
 * on the vault side (F3 provisioning) is not built.
 */
export function gracePolicyTerms(graceDays: number | null): string {
  const base =
    "Turning off automatic renewal stops future charges and keeps your access until the end of the period you have paid for. " +
    "Cancelling also stops all future charges, but can end your access sooner."
  if (graceDays === null) return base
  const cancel =
    graceDays > 0
      ? ` If you cancel a renewing subscription, you keep full access through the period you have paid for plus ${days(graceDays)}.`
      : " If you cancel a renewing subscription, you keep full access through the period you have paid for."
  const failed =
    graceDays > 0
      ? ` If renewal payments keep failing, you keep full access for ${days(graceDays)} more while one final attempt is made to charge your card; if that fails, full access ends and the subscription becomes read-only.`
      : " If renewal payments keep failing, one final attempt is made to charge your card; if that fails, full access ends and the subscription becomes read-only."
  return base + cancel + failed
}

// ---------------------------------------------------------------------------
// Checkout decisions
// ---------------------------------------------------------------------------

/**
 * What the subscribe step stores on the cart, and the checkout reads back.
 * `auto_renew_disclosure_version` is set only when the customer approved.
 */
export type SubscriptionCheckout = {
  interval: SubscriptionInterval
  auto_renew_approved: boolean
  auto_renew_disclosure_version: string | null
}

export const SUBSCRIPTION_CHECKOUT_METADATA_KEY = "subscription_checkout"

/**
 * What the subscribe step writes on the cart: the customer's answer plus the
 * one variant it was given for. The variant ties the answer to the cart line,
 * so a stale answer can never route a different purchase.
 */
export type StoredSubscriptionCheckout = SubscriptionCheckout & { variant_id: string }

/** What the subscribe form submits: the checkbox decides the approval. */
export function subscribeSubmission(args: {
  interval: SubscriptionInterval
  autoRenewTicked: boolean
}): SubscriptionCheckout {
  return {
    interval: args.interval,
    auto_renew_approved: args.autoRenewTicked === true,
    auto_renew_disclosure_version:
      args.autoRenewTicked === true ? AUTO_RENEW_DISCLOSURE_VERSION : null,
  }
}

type CartLike =
  | {
      metadata?: Record<string, unknown> | null
      items?: Array<{ variant_id?: string | null; quantity?: number | null } | null> | null
    }
  | null
  | undefined

/**
 * The subscription checkout recorded on a cart, or null — always null with the
 * flag off, so every checkout path stays exactly as it was.
 *
 * Also null unless the cart is still exactly what the subscribe step made: one
 * line, quantity 1, of the variant the answer was given for. A cart whose
 * lines changed afterwards is an ordinary purchase — no off-session card
 * setup, no POST /store/subscriptions — rather than a subscription refused by
 * the backend after the card was already confirmed.
 */
export function subscriptionCheckoutOf(
  cart: CartLike,
  flagOn: boolean
): SubscriptionCheckout | null {
  if (!flagOn) return null
  const raw = cart?.metadata?.[SUBSCRIPTION_CHECKOUT_METADATA_KEY]
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.interval !== "string" ||
    !(SUBSCRIPTION_INTERVALS as readonly string[]).includes(r.interval) ||
    typeof r.auto_renew_approved !== "boolean" ||
    typeof r.variant_id !== "string"
  ) {
    return null
  }
  const lines = (cart?.items ?? []).filter((item) => !!item)
  if (lines.length !== 1 || lines[0]?.variant_id !== r.variant_id || lines[0]?.quantity !== 1) {
    return null
  }
  return {
    interval: r.interval as SubscriptionInterval,
    auto_renew_approved: r.auto_renew_approved,
    auto_renew_disclosure_version:
      typeof r.auto_renew_disclosure_version === "string"
        ? r.auto_renew_disclosure_version
        : null,
  }
}

/**
 * Extra payment-session data for a cart: ask Stripe to keep the card for
 * off-session renewals ONLY for a subscription cart whose customer approved
 * auto-renewal (the pattern the Blackout hosted checkout uses). Every other
 * cart — including a one-period subscription — gets undefined, i.e. the
 * session is started exactly as before.
 */
export function paymentSessionDataFor(
  cart: CartLike,
  flagOn: boolean
): { setup_future_usage: "off_session" } | undefined {
  const checkout = subscriptionCheckoutOf(cart, flagOn)
  return checkout?.auto_renew_approved ? { setup_future_usage: "off_session" } : undefined
}

type SessionLike = { provider_id?: string | null; data?: unknown } | null | undefined

/**
 * The `initiatePaymentSession` arguments for the payment step's submit, or
 * null when the active session can be reused as it is. With no session data
 * (every cart but an approved subscription cart, and always with the flag
 * off) this is exactly the old rule: (re)initiate only when the provider
 * changed. An approved subscription cart also re-initiates when the session it
 * would reuse was started without off-session setup (e.g. before the
 * subscribe step), so the card is kept for renewals.
 */
export function paymentSessionInitArgs(args: {
  activeSession: SessionLike
  selectedProviderId: string
  sessionData: { setup_future_usage: "off_session" } | undefined
}): { provider_id: string; data?: { setup_future_usage: "off_session" } } | null {
  const { activeSession, selectedProviderId, sessionData } = args
  const sameProvider = activeSession?.provider_id === selectedProviderId
  const sessionUsage = (activeSession?.data as { setup_future_usage?: unknown } | null | undefined)
    ?.setup_future_usage
  const lacksSetup = !!sessionData && sessionUsage !== sessionData.setup_future_usage
  if (sameProvider && !lacksSetup) return null
  return { provider_id: selectedProviderId, ...(sessionData ? { data: sessionData } : {}) }
}

// ---------------------------------------------------------------------------
// Account page
// ---------------------------------------------------------------------------

export type StoreSubscription = {
  id: string
  status: string
  interval: SubscriptionInterval
  product_id?: string | null
  next_order_date?: string | null
  expiration_date?: string | null
  grace_ends_at?: string | null
  auto_renew_approved?: boolean | null
  payment_method_id?: string | null
  metadata?: Record<string, unknown> | null
}

/** Auto-renew as the account page shows it, and what the toggle may do. */
export type AutoRenewState =
  | { kind: "on" }
  | { kind: "off_can_approve" }
  | { kind: "off" }

export function autoRenewState(sub: StoreSubscription, now: Date = new Date()): AutoRenewState {
  const running = sub.status === "active" || sub.status === "paused"
  if (running && !sub.expiration_date) return { kind: "on" }
  const endsInFuture =
    !!sub.expiration_date && new Date(sub.expiration_date).getTime() > now.getTime()
  // Turning renewal back on needs a card kept for renewals (none is kept when
  // the customer declined at purchase); the backend refuses without one.
  if (sub.status === "active" && !sub.next_order_date && endsInFuture && !!sub.payment_method_id) {
    return { kind: "off_can_approve" }
  }
  return { kind: "off" }
}

/** `metadata.paused_reason` prefix the backend's dunning loop writes on exhaustion. */
const DUNNING_PAUSE_PREFIX = "payment_failed_after_"

const isDunningPaused = (sub: StoreSubscription) => {
  const reason = sub.metadata?.paused_reason
  return sub.status === "paused" && typeof reason === "string" && reason.startsWith(DUNNING_PAUSE_PREFIX)
}

/**
 * The charge line and the automatic-renewal line for one subscription, true
 * to what the backend will do next:
 *
 *   - grace after failed payments (past_due with a next order date): one
 *     final charge IS scheduled — say so, and that cancelling stops it
 *     (`cancelDuringGrace` drops it);
 *   - paused by the dunning loop: the backend may still move it into grace
 *     with a final charge, so never "no further charges";
 *   - a voluntary pause: nothing is charged while paused.
 */
export function chargeSummary(
  sub: StoreSubscription,
  formatDate: (value?: string | null) => string | null,
  now: Date = new Date()
): { charge: string; autoRenew: string } {
  const renew = autoRenewState(sub, now)
  if (sub.status === "past_due") {
    if (sub.next_order_date) {
      return {
        charge: `Final payment attempt: ${formatDate(sub.next_order_date)}. Cancel to stop it.`,
        autoRenew: "Automatic renewal: on hold — payment overdue",
      }
    }
    const ends = formatDate(sub.grace_ends_at)
    return {
      charge: ends ? `No further charges. Full access ends ${ends}.` : "No further charges.",
      autoRenew: "Automatic renewal: off",
    }
  }
  if (isDunningPaused(sub)) {
    return {
      charge: "A renewal payment failed. One final attempt to charge your card may still be made; cancel to stop it.",
      autoRenew: "Automatic renewal: on hold — payment failed",
    }
  }
  if (sub.status === "paused") {
    const ends = formatDate(sub.expiration_date)
    return {
      charge: ends ? `No charges while paused. Access ends ${ends}.` : "No charges while paused.",
      autoRenew: `Automatic renewal: ${renew.kind === "on" ? "on" : "off"}`,
    }
  }
  if (renew.kind === "on") {
    const next = formatDate(sub.next_order_date)
    return {
      charge: next ? `Next charge: ${next}` : "No charge is scheduled.",
      autoRenew: "Automatic renewal: on",
    }
  }
  const ends = formatDate(sub.expiration_date)
  return {
    charge: ends ? `No further charges. Access ends ${ends}.` : "No further charges.",
    autoRenew: "Automatic renewal: off",
  }
}

/** Statuses a customer may still cancel from. */
export function canCancel(sub: StoreSubscription): boolean {
  return sub.status === "active" || sub.status === "paused" || sub.status === "past_due"
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  past_due: "Grace period",
  read_only: "Read-only",
  canceled: "Cancelled",
  expired: "Ended",
  failed: "Payment failed",
}

export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status
