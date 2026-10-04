export type PaymentProviderOptions = {
  /** The PLATFORM secret key; the connected account rides in the request header. */
  apiKey: string
}

/**
 * What a payment session may carry in `data` for this provider. The connected
 * account itself travels in the session CONTEXT
 * (`shared/stripe-direct-charge.ts` `DIRECT_CHARGE_CONTEXT_KEY`), the channel
 * the stock store route cannot write; a `connected_account_id` here is only a
 * cross-check and must agree with it. Without the context marker there is no
 * direct charge, and the provider refuses rather than falling back to a
 * platform charge.
 */
export type DirectChargeSessionData = {
  connected_account_id?: string
  metadata?: Record<string, string>
  payment_description?: string
}
