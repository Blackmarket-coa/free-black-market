/**
 * Save a card against a SetupIntent, using Stripe.js loaded from Stripe's CDN.
 *
 * No bundled `@stripe/stripe-js` dependency: the panel injects Stripe's own
 * script at runtime and drives it through the global `window.Stripe`. That is
 * exactly what the npm loader does under the hood, minus a supply-chain
 * addition to a package the CI does not type-check. The card lives in a Stripe
 * Elements iframe the whole time — card details never enter this app's
 * JavaScript, which is what keeps the panel out of PCI scope.
 *
 * Everything here degrades to a returned error rather than a throw: a billing
 * form that explodes because a CDN was slow is worse than one that says "try
 * again".
 */

const STRIPE_JS_SRC = "https://js.stripe.com/v3/"

type StripeCardElement = {
  mount: (selector: string | HTMLElement) => void
  unmount: () => void
  destroy: () => void
  on: (event: string, handler: (e: { error?: { message?: string } }) => void) => void
}

type StripeElements = {
  create: (type: "card", options?: Record<string, unknown>) => StripeCardElement
}

type StripeInstance = {
  elements: (options?: Record<string, unknown>) => StripeElements
  confirmCardSetup: (
    clientSecret: string,
    data: { payment_method: { card: StripeCardElement } }
  ) => Promise<{
    error?: { message?: string }
    setupIntent?: { status: string; payment_method: string | null }
  }>
}

type StripeConstructor = (key: string) => StripeInstance

declare global {
  interface Window {
    Stripe?: StripeConstructor
  }
}

let loaderPromise: Promise<StripeConstructor | null> | null = null

/**
 * Load Stripe.js once and cache the promise. Concurrent callers share the same
 * in-flight load rather than injecting the script twice.
 */
export function loadStripeJs(): Promise<StripeConstructor | null> {
  if (typeof window === "undefined") return Promise.resolve(null)
  if (window.Stripe) return Promise.resolve(window.Stripe)
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${STRIPE_JS_SRC}"]`
    )
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Stripe ?? null))
      existing.addEventListener("error", () => resolve(null))
      // Already loaded between the check above and here.
      if (window.Stripe) resolve(window.Stripe)
      return
    }

    const script = document.createElement("script")
    script.src = STRIPE_JS_SRC
    script.async = true
    script.onload = () => resolve(window.Stripe ?? null)
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      loaderPromise = null
      resolve(null)
    }
    document.head.appendChild(script)
  })

  return loaderPromise
}

export type CardMount = {
  /** Confirm the SetupIntent with the mounted card. */
  confirm: () => Promise<{ ok: true } | { ok: false; error: string }>
  /** Subscribe to inline validation errors from the card field. */
  onError: (handler: (message: string | null) => void) => void
  /** Tear the element down. Safe to call more than once. */
  destroy: () => void
}

/**
 * Mount a Stripe card element into `container` and return a handle that
 * confirms the SetupIntent.
 *
 * Returns null when Stripe.js could not load or the key is missing, so the
 * caller can show "card entry is unavailable" instead of a blank box.
 */
export async function mountCardSetup(args: {
  publishableKey: string
  clientSecret: string
  container: HTMLElement
}): Promise<CardMount | null> {
  const Stripe = await loadStripeJs()
  if (!Stripe || !args.publishableKey || !args.clientSecret) return null

  let stripe: StripeInstance
  let card: StripeCardElement
  try {
    stripe = Stripe(args.publishableKey)
    const elements = stripe.elements()
    card = elements.create("card")
    card.mount(args.container)
  } catch {
    return null
  }

  let destroyed = false

  return {
    onError: (handler) => {
      card.on("change", (e) => handler(e.error?.message ?? null))
    },
    confirm: async () => {
      try {
        const result = await stripe.confirmCardSetup(args.clientSecret, {
          payment_method: { card },
        })
        if (result.error) {
          return { ok: false, error: result.error.message ?? "Card was declined." }
        }
        if (result.setupIntent?.status === "succeeded") {
          return { ok: true }
        }
        return {
          ok: false,
          error: "Card setup did not complete. Please try again.",
        }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Card setup failed.",
        }
      }
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      try {
        card.unmount()
        card.destroy()
      } catch {
        // Element may already be gone if the modal unmounted first.
      }
    },
  }
}
