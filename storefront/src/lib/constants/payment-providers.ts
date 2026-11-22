/**
 * Which payment providers the cart checkout can take money with.
 *
 * The ids are the backend's, not ours to choose: Medusa names a provider
 * `pp_{identifier}_{id}` from what `backend/medusa-config.ts` registers, and
 * `GET /store/payment-providers` serves the ones a region lists. This file is
 * the storefront's half of that agreement.
 *
 * It was not kept. `isStripe` matched `pp_card_stripe-connect`, the id of
 * `@mercurjs/payment-stripe-connect`, carried over from Mercur's storefront
 * starter. This backend does not register that provider; it registers
 * `@medusajs/medusa/payment-stripe` as `stripe`, whose card provider is
 * `pp_stripe_stripe`. So no provider the backend can serve was a card to the
 * checkout: the payment step drew no card form, no Stripe Elements were
 * mounted, and the review step's button stayed a disabled "Select a payment
 * method".
 *
 * Exact ids, never prefixes. `pp_stripe_` is also how
 * `pp_stripe_connect_direct_stripe_connect_direct` starts (Stripe Connect
 * direct charges; flag-gated, and only for the donation and carried-pool
 * checkouts). That provider refuses a session opened by the cart checkout, and
 * its intents live on a connected account this page's Stripe.js is not
 * initialised for. The Stripe module's other providers
 * (`pp_stripe-ideal_stripe`, `pp_stripe-bancontact_stripe`, ...) are redirect
 * methods; the card form cannot confirm them.
 *
 * Pure TS with no imports, on purpose:
 * `backend/integration-tests/http/storefront-payment-providers.spec.ts` loads
 * this file and holds it against the providers a booted backend registers, so
 * a change on either side fails there instead of at a buyer's checkout.
 */

/** `@medusajs/medusa/payment-stripe`, registered as `stripe`: card payments. */
export const STRIPE_CARD_PROVIDER_ID = "pp_stripe_stripe"

/** Medusa's built-in manual provider. It takes no money itself. */
export const MANUAL_PROVIDER_ID = "pp_system_default"

/** True for the one provider the card form (Stripe Elements, `confirmCardPayment`) can pay with. */
export const isStripe = (providerId?: string | null): boolean => {
  return providerId === STRIPE_CARD_PROVIDER_ID
}

export const isManual = (providerId?: string | null) => {
  return providerId?.startsWith(MANUAL_PROVIDER_ID)
}

/**
 * Whether the checkout offers a provider to buyers.
 *
 * Medusa's manual provider takes no money. An order placed on it is recorded
 * as paid, and captured, and nobody is ever charged. The backend's seed
 * scripts list it on the regions they create (`backend/src/scripts/seed.ts`),
 * and the checkout offered every listed provider, so a production storefront
 * on such a region showed "Manual Payment" to every buyer; only the badge
 * marking it as a test was limited to development. Now only a development
 * build (`next dev`) offers it.
 *
 * `nodeEnv` is `process.env.NODE_ENV` as the caller's bundle has it.
 * `next build` writes "production" into every bundle, server and client,
 * whatever NODE_ENV the build ran with, unless `experimental.
 * allowDevelopmentBuild` is set (`next/dist/build/define-env.js`); this
 * storefront does not set it, and its Docker build runs `next build` under
 * `ENV NODE_ENV=production`. So a production image cannot offer it, and
 * neither the image's runtime NODE_ENV nor docker-compose's
 * `NODE_ENV: development` changes that. All three are pinned in
 * `src/lib/__tests__/checkout-payment-providers.test.ts`.
 */
export const offeredAtCheckout = (
  providerId: string | null | undefined,
  nodeEnv: string | undefined
): boolean => {
  return !!providerId && (!isManual(providerId) || nodeEnv === "development")
}
