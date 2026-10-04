import type { PaymentProviderOptions } from "./types"

/**
 * How — and whether — the direct-charge provider is registered.
 *
 * Pure and dependency-free because `medusa-config.ts` imports it on the boot
 * path (the `lib/build-auth-module.ts` precedent). The provider is registered
 * only when ALL of:
 *
 *   1. `FF_NONPROFIT_PARITY_V1 === "true"` — the Phase 1 flag. Nothing in the
 *      direct-charge donation path may be reachable with the flag off, and an
 *      unregistered provider is unreachable by construction.
 *   2. `STRIPE_CONNECT_DIRECT_ENABLED === "true"` — the operator's explicit
 *      statement that direct charges may be minted. Only the literal string.
 *   3. `STRIPE_API_KEY` is present — a direct charge is authenticated with the
 *      PLATFORM's secret key plus the `Stripe-Account` header, so this is the
 *      same key the stock `stripe` provider uses; there is no second key.
 *
 * Absent any one, `stripeConnectDirectProviderConfig` returns null and the
 * payment module never learns the provider exists. Legal checkpoints L24 and
 * L25 (docs/legal/checkpoints.md) are unresolved: the operator may not set
 * (2) for live money until counsel clears them. This file surfaces that; it
 * does not decide it.
 */

/** `static identifier` on the provider class. */
export const STRIPE_CONNECT_DIRECT_PROVIDER_IDENTIFIER = "stripe_connect_direct"

/** The `id` the provider is registered under in `medusa-config.ts`. */
export const STRIPE_CONNECT_DIRECT_REGISTRATION_ID = "stripe_connect_direct"

/**
 * The payment-session `provider_id` Medusa derives: `pp_{identifier}_{id}`
 * (the same rule that makes the stock provider `pp_stripe_stripe`).
 */
export const STRIPE_CONNECT_DIRECT_PROVIDER_ID =
  `pp_${STRIPE_CONNECT_DIRECT_PROVIDER_IDENTIFIER}_${STRIPE_CONNECT_DIRECT_REGISTRATION_ID}` as const

export const STRIPE_CONNECT_DIRECT_ENABLED_ENV = "STRIPE_CONNECT_DIRECT_ENABLED"
export const STRIPE_CONNECT_WEBHOOK_SECRET_ENV = "STRIPE_CONNECT_WEBHOOK_SECRET"

type Env = Record<string, string | undefined>

export function isStripeConnectDirectConfigured(env: Env = process.env): boolean {
  return (
    env.FF_NONPROFIT_PARITY_V1 === "true" &&
    env[STRIPE_CONNECT_DIRECT_ENABLED_ENV] === "true" &&
    typeof env.STRIPE_API_KEY === "string" &&
    env.STRIPE_API_KEY.length > 0
  )
}

export type StripeConnectDirectProviderRegistration = {
  resolve: string
  id: typeof STRIPE_CONNECT_DIRECT_REGISTRATION_ID
  options: PaymentProviderOptions
}

/**
 * The entry for the payment module's `providers` array, or null when the
 * provider must not exist in this process.
 */
export function stripeConnectDirectProviderConfig(
  env: Env = process.env
): StripeConnectDirectProviderRegistration | null {
  if (!isStripeConnectDirectConfigured(env)) return null
  return {
    resolve: "./src/modules/stripe-connect-direct",
    id: STRIPE_CONNECT_DIRECT_REGISTRATION_ID,
    options: { apiKey: env.STRIPE_API_KEY as string },
  }
}
