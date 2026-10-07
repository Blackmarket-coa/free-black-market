import { createLogger } from "../shared/logger"
const log = createLogger("lib/stripe-payment-webhook")
import Stripe from "stripe"

/**
 * Reading a Stripe event off Medusa's own payment webhook. Stripe posts to
 * `/hooks/payment/<provider>`, and Medusa re-emits the request as
 * `payment.webhook_received` (`{ provider, payload: { rawData, headers } }`)
 * for its own `payment-webhook` subscriber, which acts on payment-intent
 * events only. FBM subscribers listen to the same event — no new endpoint —
 * and verify the Stripe signature themselves, against the same
 * `STRIPE_WEBHOOK_SECRET` the Stripe provider is configured with, before
 * reading anything. Stripe only delivers the event types ticked on that
 * endpoint.
 *
 * Used by `subscribers/emit-blackout-stripe-payment-events.ts` and
 * `subscribers/hawala-card-stripe-events.ts`.
 */

export type PaymentWebhookInput = {
  provider?: unknown
  payload?: {
    rawData?: unknown
    headers?: Record<string, unknown> | null
  } | null
}

/**
 * The raw request bytes Medusa's route captured (`req.rawBody`). A Redis event
 * bus round-trips a Buffer as `{ type: "Buffer", data }`, the same form
 * Medusa's own webhook subscriber revives.
 */
export function rawBodyOf(raw: unknown): Buffer | null {
  if (Buffer.isBuffer(raw)) {
    return raw
  }
  const serialized = raw as { type?: unknown; data?: unknown } | null
  if (serialized?.type === "Buffer" && Array.isArray(serialized.data)) {
    return Buffer.from(serialized.data as number[])
  }
  return null
}

/**
 * The verified Stripe event carried by a `payment.webhook_received`, or null
 * when it came through a provider `acceptProvider` refuses (given the
 * provider id as Medusa names it, `pp_<provider>`), the webhook secret is
 * unset, or the signature does not verify.
 */
export function verifyStripePaymentWebhook(
  input: PaymentWebhookInput | null | undefined,
  acceptProvider: (providerId: string) => boolean,
  logPrefix: string
): Stripe.Event | null {
  const provider = input?.provider
  if (typeof provider !== "string" || !acceptProvider(`pp_${provider}`)) {
    return null
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return null
  }
  const rawBody = rawBodyOf(input?.payload?.rawData)
  const header = input?.payload?.headers?.["stripe-signature"]
  const signature = Array.isArray(header) ? header[0] : header
  if (!rawBody || typeof signature !== "string" || !signature) {
    return null
  }
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    log.warn(`${logPrefix} Stripe signature did not verify:`, err instanceof Error ? err.message : err)
    return null
  }
}
