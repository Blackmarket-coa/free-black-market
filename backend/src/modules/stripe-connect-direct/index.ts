import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import StripeConnectDirectProviderService from "./service"

/**
 * Payment provider: Stripe Connect direct charges on a connected account.
 *
 * Registered by `medusa-config.ts` only when `registration.ts` says so (flag,
 * explicit enable, platform key). `@mercurjs/payment-stripe-connect` stays
 * unregistered: it mints plain platform intents.
 */
export default ModuleProvider(Modules.PAYMENT, {
  services: [StripeConnectDirectProviderService],
})

export * from "./registration"
export type { DirectChargeSessionData, PaymentProviderOptions } from "./types"
