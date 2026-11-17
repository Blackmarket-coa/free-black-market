import fs from "fs"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow, refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"
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
 * card form reads, for the amount the buyer is shown.
 *
 * The fourth is about that amount. Stripe charges what the session was opened
 * for, and only a cart workflow that ends in Medusa's payment refresh keeps
 * that equal to the cart's total. It changes a line item's price through the
 * cart module with nothing run afterwards, which is what FBM's tier and
 * wholesale routes did until SD-115 (they now refresh the cart; that, and
 * Mercur's shipping-method routes, are pinned in cart-payment-refresh.spec.ts),
 * so here it stands for a writer nobody has found. It holds the storefront's
 * refusal (`storefront/src/lib/helpers/card-charge.ts`, run here too) against
 * the cart the backend then serves.
 *
 * What a buyer then sees for each id is the storefront's own spec:
 * `storefront/src/components/sections/__tests__/checkout-card-payment.test.tsx`.
 */

const STOREFRONT_SRC = path.resolve(__dirname, "../../../storefront/src")
const STOREFRONT_PROVIDERS = path.join(STOREFRONT_SRC, "lib/constants/payment-providers.ts")
const STOREFRONT_CARD_CHARGE = path.join(STOREFRONT_SRC, "lib/helpers/card-charge.ts")

type StorefrontProviders = {
  STRIPE_CARD_PROVIDER_ID: string
  MANUAL_PROVIDER_ID: string
  isStripe: (providerId?: string | null) => boolean
  isManual: (providerId?: string | null) => boolean | undefined
}

type StorefrontCardCharge = {
  cardChargeMatchesCartTotal: (
    session: { amount?: unknown } | null | undefined,
    cart: { total?: unknown; currency_code?: string | null } | null | undefined
  ) => boolean
}

function loadStorefront(): (StorefrontProviders & StorefrontCardCharge) | null {
  for (const file of [STOREFRONT_PROVIDERS, STOREFRONT_CARD_CHARGE]) {
    if (!fs.existsSync(file)) {
      // The backend is sometimes checked out on its own; in CI the whole repo
      // is there and a missing file must fail, never pass by skipping.
      if (process.env.CI) throw new Error(`storefront checkout module not found at ${file}`)
      return null
    }
  }
  return {
    ...(jest.requireActual(STOREFRONT_PROVIDERS) as StorefrontProviders),
    ...(jest.requireActual(STOREFRONT_CARD_CHARGE) as StorefrontCardCharge),
  }
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
    type StripeCall = (...args: unknown[]) => Promise<unknown>
    type RegisteredProvider = {
      constructor: { identifier?: string }
      stripe_: { paymentIntents: { create: StripeCall; update: StripeCall; cancel: StripeCall } }
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

    type ServedSession = { provider_id: string; status: string; amount: unknown; data: Record<string, unknown> }
    type ServedCart = {
      total: unknown
      currency_code: string
      payment_collection: { amount: unknown; payment_sessions: ServedSession[] }
    }

    /**
     * A cart with one line (3 x 19.99, so the total has cents) in a region
     * that lists the card provider, with Stripe's API replaced on the
     * registered provider instance and nothing else.
     */
    const cartInACardRegion = async () => {
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

      let intents = 0
      const intentsApi = providerOf(card).stripe_.paymentIntents
      const createIntent = jest.spyOn(intentsApi, "create").mockImplementation(async (params: unknown) => {
        intents += 1
        return {
          ...(params as Record<string, unknown>),
          id: `pi_test_storefront_pin_${intents}`,
          object: "payment_intent",
          status: "requires_payment_method",
          client_secret: `pi_test_storefront_pin_${intents}_secret`,
        }
      })
      const updateIntent = jest.spyOn(intentsApi, "update").mockImplementation(async () => ({}))
      const cancelIntent = jest
        .spyOn(intentsApi, "cancel")
        .mockImplementation(async (id: unknown) => ({ id, object: "payment_intent", status: "canceled" }))

      const cart = (await api.post(`/store/carts`, { region_id: region.id, email: "buyer@example.com" }, pak)).data.cart
      // The line goes in through the cart module. The store's add-to-cart
      // route is not what is under test, and a custom line needs no catalogue.
      const [item] = await getContainer()
        .resolve(Modules.CART)
        .addLineItems(cart.id, [{ title: "Jar of honey", unit_price: 19.99, quantity: 3 }])

      // initiatePaymentSession (the JS SDK's two calls).
      const openSession = async () => {
        const collection = (await api.post(`/store/payment-collections`, { cart_id: cart.id }, pak)).data.payment_collection
        return api
          .post(`/store/payment-collections/${collection.id}/payment-sessions`, { provider_id: card }, pak)
          .catch((e: { response: { status: number; data: unknown } }) => e.response)
      }
      // retrieveCart.
      const readCart = async (): Promise<ServedCart> =>
        (await api.get(`/store/carts/${cart.id}?fields=${encodeURIComponent(STOREFRONT_CART_FIELDS)}`, pak)).data.cart

      return { card, region, pak, cart, item, openSession, readCart, createIntent, updateIntent, cancelIntent }
    }

    run("a region's card provider reaches the checkout, and its session carries what the card form reads", async () => {
      const { card, region, pak, openSession, readCart, createIntent } = await cartInACardRegion()

      // listCartPaymentMethods (storefront/src/lib/data/payment.ts).
      const served = await api.get(`/store/payment-providers?region_id=${region.id}`, pak)
      const servedIds: string[] = served.data.payment_providers.map((p: { id: string }) => p.id).sort()
      expect(servedIds).toEqual([card, storefront!.MANUAL_PROVIDER_ID].sort())
      expect(servedIds.filter((id) => storefront!.isStripe(id))).toEqual([card])

      const opened = await openSession()
      expect(opened.status).toBe(200)
      expect(createIntent).toHaveBeenCalledTimes(1)
      // What the card will be charged: the session's amount, in cents.
      expect(createIntent.mock.calls[0][0]).toMatchObject({ amount: 5997, currency: "usd" })

      // retrieveCart: PaymentWrapper looks for a pending session on a card
      // provider, and StripeWrapper refuses to mount without its client secret.
      const cart = await readCart()
      const sessions = cart.payment_collection.payment_sessions
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({
        provider_id: card,
        status: "pending",
        data: { client_secret: "pi_test_storefront_pin_1_secret" },
      })
      expect(storefront!.isStripe(sessions[0].provider_id)).toBe(true)

      // The pay button confirms the card only when the session is for the
      // total on the page, so both must come back as numbers that agree. If
      // this read stopped serving either, no buyer could pay.
      expect(cart.total).toBe(59.97)
      expect(sessions[0].amount).toBe(59.97)
      expect(storefront!.cardChargeMatchesCartTotal(sessions[0], cart)).toBe(true)
    })

    run("a total changed outside Medusa's cart workflows leaves the card session at the old amount, and the storefront refuses it", async () => {
      const { cart, item, openSession, readCart, createIntent, updateIntent, cancelIntent } = await cartInACardRegion()
      expect((await openSession()).status).toBe(200)

      // A cart module write with no workflow after it: how POST
      // /store/carts/:id/tier and /wholesale repriced a line before SD-115.
      await getContainer().resolve(Modules.CART).updateLineItems(item.id, { unit_price: 12.99, is_custom_price: true })

      const stale = await readCart()
      expect(stale.total).toBe(38.97)
      // Nothing told the payment side. The session is still pending, for the
      // old amount, on the same intent, and Stripe was not called.
      expect(stale.payment_collection.amount).toBe(59.97)
      expect(stale.payment_collection.payment_sessions).toHaveLength(1)
      expect(stale.payment_collection.payment_sessions[0]).toMatchObject({
        status: "pending",
        amount: 59.97,
        data: { id: "pi_test_storefront_pin_1" },
      })
      expect(updateIntent).not.toHaveBeenCalled()
      expect(cancelIntent).not.toHaveBeenCalled()
      // Confirming that session would charge 59.97 for a 38.97 cart.
      expect(storefront!.cardChargeMatchesCartTotal(stale.payment_collection.payment_sessions[0], stale)).toBe(false)

      // Choosing the card again does not help: the new session takes the
      // collection's amount, which nothing has corrected.
      expect((await openSession()).status).toBe(200)
      const repicked = await readCart()
      expect(repicked.payment_collection.payment_sessions).toHaveLength(1)
      expect(repicked.payment_collection.payment_sessions[0]).toMatchObject({ status: "pending", amount: 59.97 })
      expect(createIntent.mock.calls[1][0]).toMatchObject({ amount: 5997 })
      expect(storefront!.cardChargeMatchesCartTotal(repicked.payment_collection.payment_sessions[0], repicked)).toBe(false)

      // What Medusa's cart workflows run after a change of total, and this
      // write did not: the collection takes the new amount and the session
      // for the old one is deleted, its intent cancelled.
      const cancelledBefore = cancelIntent.mock.calls.length
      await refreshPaymentCollectionForCartWorkflow(getContainer()).run({ input: { cart_id: cart.id } })
      const refreshed = await readCart()
      expect(refreshed.payment_collection.amount).toBe(38.97)
      expect(refreshed.payment_collection.payment_sessions).toHaveLength(0)
      expect(cancelIntent.mock.calls.length).toBe(cancelledBefore + 1)

      // And then choosing the card again does: a session for the new total.
      expect((await openSession()).status).toBe(200)
      const paid = await readCart()
      expect(createIntent.mock.calls[2][0]).toMatchObject({ amount: 3897 })
      expect(paid.payment_collection.payment_sessions).toHaveLength(1)
      expect(storefront!.cardChargeMatchesCartTotal(paid.payment_collection.payment_sessions[0], paid)).toBe(true)
    })
  },
})
