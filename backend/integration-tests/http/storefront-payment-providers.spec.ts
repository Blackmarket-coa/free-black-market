import fs from "fs"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows"
import {
  STRIPE_CONNECT_DIRECT_PROVIDER_ID,
  isStripeConnectDirectConfigured,
} from "../../src/modules/stripe-connect-direct/registration"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * The storefront's checkout and the backend agree on what a card provider is
 * called.
 *
 * They did not. The storefront drew its card form, mounted Stripe Elements and
 * offered "Place order" only for `pp_card_stripe-connect`, the id of
 * `@mercurjs/payment-stripe-connect` (its starter's backend). This backend
 * registers `@medusajs/medusa/payment-stripe` as `stripe`, which Medusa names
 * `pp_stripe_stripe`, and Mercur's provider not at all, so a region could
 * never list the id the storefront waited for and the id it could list got a
 * disabled "Select a payment method". Nothing failed: each side was
 * consistent with itself.
 *
 * So this boots the backend, reads the providers the payment module really
 * registered, and holds the storefront's own module against them
 * (`storefront/src/lib/constants/payment-providers.ts`, pure TS, run here
 * rather than read as text). A provider added, removed or renamed in
 * `medusa-config.ts` fails the first test until someone decides what the
 * checkout does with it; a storefront check that stops matching the card
 * provider, or starts matching another one, fails the second. The third walks
 * the store routes the checkout calls and checks the session carries what the
 * card form reads.
 *
 * What a buyer then sees for each id is the storefront's own spec:
 * `storefront/src/components/sections/__tests__/checkout-card-payment.test.tsx`.
 */

const STOREFRONT_PROVIDERS = path.resolve(__dirname, "../../../storefront/src/lib/constants/payment-providers.ts")

type StorefrontProviders = {
  STRIPE_CARD_PROVIDER_ID: string
  MANUAL_PROVIDER_ID: string
  isStripe: (providerId?: string | null) => boolean
  isManual: (providerId?: string | null) => boolean | undefined
}

function loadStorefront(): StorefrontProviders | null {
  if (!fs.existsSync(STOREFRONT_PROVIDERS)) {
    // The backend is sometimes checked out on its own; in CI the whole repo
    // is there and a missing file must fail, never pass by skipping.
    if (process.env.CI) throw new Error(`storefront payment providers not found at ${STOREFRONT_PROVIDERS}`)
    return null
  }
  return jest.requireActual(STOREFRONT_PROVIDERS) as StorefrontProviders
}

/**
 * Everything `medusa-config.ts` registers with the payment module: Medusa's
 * manual provider, and the eight services of `@medusajs/medusa/payment-stripe`
 * under the id `stripe`. Only `pp_stripe_stripe` takes a card; the other seven
 * are redirect methods the storefront has no flow for.
 */
const REGISTERED = [
  "pp_stripe-bancontact_stripe",
  "pp_stripe-blik_stripe",
  "pp_stripe-giropay_stripe",
  "pp_stripe-ideal_stripe",
  "pp_stripe-oxxo_stripe",
  "pp_stripe-promptpay_stripe",
  "pp_stripe-przelewy24_stripe",
  "pp_stripe_stripe",
  "pp_system_default",
  // Stripe Connect direct charges: only with FF_NONPROFIT_PARITY_V1, an
  // explicit enable and the platform key (registration.ts), all unset here
  // and in CI.
  ...(isStripeConnectDirectConfigured(process.env) ? [STRIPE_CONNECT_DIRECT_PROVIDER_ID] : []),
].sort()

/** The fields `retrieveCart` asks for (storefront/src/lib/data/cart.ts). */
const STOREFRONT_CART_FIELDS =
  "*items,*region, *items.product, *items.variant, *items.variant.options, items.variant.options.option.title," +
  "*items.thumbnail, *items.metadata, +items.total, *promotions, +shipping_methods.name, *items.product.seller"

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const storefront = loadStorefront()
    const run = storefront ? it : it.skip

    const payments = () => getContainer().resolve(Modules.PAYMENT)
    const registered = async (): Promise<string[]> => {
      const providers = await payments().listPaymentProviders({}, { take: 200 })
      return providers
        .filter((p: { is_enabled?: boolean }) => p.is_enabled)
        .map((p: { id: string }) => p.id)
        .sort()
    }

    /**
     * The provider instance the payment module registered under an id, as the
     * settlement specs reach it. Not part of the module's public interface.
     */
    type RegisteredProvider = {
      constructor: { identifier?: string }
      stripe_: { paymentIntents: { create: (...args: unknown[]) => Promise<unknown> } }
    }
    const providerOf = (id: string): RegisteredProvider =>
      (
        payments() as unknown as { paymentProviderService_: { retrieveProvider: (id: string) => RegisteredProvider } }
      ).paymentProviderService_.retrieveProvider(id)

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it("registers the payment providers this spec was written against", async () => {
      // A change here is a change to what a region can offer a buyer. Before
      // updating the list, decide what the storefront's checkout does with
      // the new id (storefront/src/lib/constants/payment-providers.ts).
      expect(await registered()).toEqual(REGISTERED)
    })

    run("the storefront takes a card with the registered card provider and with nothing else", async () => {
      const ids = await registered()

      expect(ids.filter((id) => storefront!.isStripe(id))).toEqual(["pp_stripe_stripe"])
      expect(storefront!.STRIPE_CARD_PROVIDER_ID).toBe("pp_stripe_stripe")
      // The provider behind that id is Medusa's Stripe card service.
      expect(providerOf(storefront!.STRIPE_CARD_PROVIDER_ID).constructor.identifier).toBe("stripe")

      expect(ids.filter((id) => storefront!.isManual(id))).toEqual(["pp_system_default"])
      expect(storefront!.MANUAL_PROVIDER_ID).toBe("pp_system_default")

      // Registered or not in this process: a direct charge lives on a
      // connected account and refuses a session the cart checkout opens, and
      // its id starts with `pp_stripe_` too, so it must never read as a card.
      expect(storefront!.isStripe(STRIPE_CONNECT_DIRECT_PROVIDER_ID)).toBe(false)
      expect(storefront!.isManual(STRIPE_CONNECT_DIRECT_PROVIDER_ID)).toBeFalsy()
      // The id the storefront used to wait for is not one this backend has.
      expect(ids).not.toContain("pp_card_stripe-connect")
      expect(storefront!.isStripe("pp_card_stripe-connect")).toBe(false)
    })

    run("a region's card provider reaches the checkout, and its session carries what the card form reads", async () => {
      const card = storefront!.STRIPE_CARD_PROVIDER_ID
      // Providers are attached the way the seed scripts attach them. Two
      // countries, so that Medusa does not give the cart a shipping address:
      // this spec is about the payment session, and the cart is read below.
      const { result } = await createRegionsWorkflow(getContainer()).run({
        input: {
          regions: [
            {
              name: "United States",
              currency_code: "usd",
              countries: ["us", "ca"],
              payment_providers: [card, storefront!.MANUAL_PROVIDER_ID],
            },
          ],
        },
      })
      const region = result[0]
      const pak = pakHeaders(await createPublishableKeyToken(getContainer))

      // listCartPaymentMethods (storefront/src/lib/data/payment.ts).
      const served = await api.get(`/store/payment-providers?region_id=${region.id}`, pak)
      const servedIds: string[] = served.data.payment_providers.map((p: { id: string }) => p.id).sort()
      expect(servedIds).toEqual([card, storefront!.MANUAL_PROVIDER_ID].sort())
      expect(servedIds.filter((id) => storefront!.isStripe(id))).toEqual([card])

      // initiatePaymentSession (the JS SDK's two calls), with only Stripe's
      // API replaced, on the registered provider instance.
      const createIntent = jest.spyOn(providerOf(card).stripe_.paymentIntents, "create").mockImplementation(async (params: unknown) => ({
        ...(params as Record<string, unknown>),
        id: "pi_test_storefront_pin",
        object: "payment_intent",
        status: "requires_payment_method",
        client_secret: "pi_test_storefront_pin_secret_1",
      }))
      const cart = (await api.post(`/store/carts`, { region_id: region.id, email: "buyer@example.com" }, pak)).data.cart
      const collection = (await api.post(`/store/payment-collections`, { cart_id: cart.id }, pak)).data.payment_collection
      const opened = await api
        .post(`/store/payment-collections/${collection.id}/payment-sessions`, { provider_id: card }, pak)
        .catch((e: { response: { status: number; data: unknown } }) => e.response)
      expect(opened.status).toBe(200)
      expect(createIntent).toHaveBeenCalledTimes(1)

      // retrieveCart: PaymentWrapper looks for a pending session on a card
      // provider, and StripeWrapper refuses to mount without its client secret.
      const read = await api.get(`/store/carts/${cart.id}?fields=${encodeURIComponent(STOREFRONT_CART_FIELDS)}`, pak)
      const sessions = read.data.cart.payment_collection.payment_sessions
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({
        provider_id: card,
        status: "pending",
        data: { client_secret: "pi_test_storefront_pin_secret_1" },
      })
      expect(storefront!.isStripe(sessions[0].provider_id)).toBe(true)
    })
  },
})
