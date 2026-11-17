import type { HttpTypes } from "@medusajs/types"
import * as React from "react"
import { useContext } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * What the checkout shows a buyer for each payment provider id the backend
 * can put on a cart — the real `PaymentWrapper`, `CartPaymentSection` and
 * `PaymentButton`, with the real Stripe Elements provider and the real radio
 * group, rendered to markup.
 *
 * The storefront's vitest has no DOM library, so this is a server render:
 * hooks run, effects do not, and what is asserted is the first paint for a
 * cart in a given state. The one interaction covered — choosing a method — is
 * reached by keeping the `onChange` the section hands the real `RadioGroup`.
 * Only the server actions (`lib/data/*`) and `next/navigation` are replaced.
 *
 * It exists because the checkout and the backend disagreed about what a card
 * provider is called (see lib/constants/payment-providers.ts): a cart on
 * `pp_stripe_stripe`, the only card provider the backend registers, got no
 * card form and a disabled "Select a payment method".
 *
 * What the checkout does when the card payment cannot go ahead (the session
 * will not open, or it was opened for another amount) is
 * checkout-card-payment-refused.test.tsx, beside this file.
 */

const { initiatePaymentSession, radioGroup } = vi.hoisted(() => {
  // PaymentWrapper reads the key once, when the module loads.
  process.env.NEXT_PUBLIC_STRIPE_KEY = "pk_test_checkout_render_spec"
  return {
    initiatePaymentSession: vi.fn(async () => ({})),
    radioGroup: { onChange: undefined as undefined | ((value: string) => unknown) },
  }
})

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("step=payment"),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/us/checkout",
}))

vi.mock("@/lib/data/cart", () => ({
  initiatePaymentSession,
  placeOrder: vi.fn(),
  placeTicketOrder: vi.fn(),
}))

vi.mock("@/lib/data/subscriptions", () => ({ completeSubscriptionCheckout: vi.fn() }))
// Reached only through the atoms barrel (LogoutButton); a server action.
vi.mock("@/lib/data/customer", () => ({ signout: vi.fn() }))

vi.mock("@headlessui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@headlessui/react")>()
  const { createElement } = await import("react")
  return {
    ...actual,
    // The real group, rendered as it is; this only remembers its onChange.
    RadioGroup: (props: { onChange?: (value: string) => unknown }) => {
      radioGroup.onChange = props.onChange
      return createElement(actual.RadioGroup as React.ElementType, props)
    },
  }
})

// The storefront's vitest has no React plugin, so esbuild compiles JSX to the
// classic `React.createElement`, which reads a global `React` — at import for
// the icons in lib/constants.tsx, hence the dynamic imports below.
;(globalThis as { React?: typeof React }).React = React

type Section = typeof import("../CartPaymentSection/CartPaymentSection").default
type Button = typeof import("../CartReview/PaymentButton").default
type Wrapper = typeof import("../../organisms/PaymentContainer/PaymentWrapper").default
type Shipping = typeof import("../../organisms/OrderDefails/OrderShipping").default

let CartPaymentSection: Section
let PaymentButton: Button
let PaymentWrapper: Wrapper
let OrderShipping: Shipping
let StripeContext: React.Context<boolean>

beforeAll(async () => {
  CartPaymentSection = (await import("../CartPaymentSection/CartPaymentSection")).default
  PaymentButton = (await import("../CartReview/PaymentButton")).default
  PaymentWrapper = (await import("../../organisms/PaymentContainer/PaymentWrapper")).default
  OrderShipping = (await import("../../organisms/OrderDefails/OrderShipping")).default
  StripeContext = (await import("../../organisms/PaymentContainer/StripeWrapper")).StripeContext
})

beforeEach(() => {
  initiatePaymentSession.mockClear()
  radioGroup.onChange = undefined
})

/** The ids a booted backend registers (default env, and with Connect direct on), plus Mercur's, which it does not. */
const CARD = "pp_stripe_stripe"
const MANUAL = "pp_system_default"
const NOT_CARDS = [
  ["Mercur's Stripe Connect id, which this backend never registers", "pp_card_stripe-connect"],
  ["Stripe Connect direct charges (donation and carried-pool checkouts only)", "pp_stripe_connect_direct_stripe_connect_direct"],
  ["a Stripe redirect method", "pp_stripe-ideal_stripe"],
  ["another Stripe redirect method", "pp_stripe-bancontact_stripe"],
] as const

const address = {
  first_name: "Ada",
  last_name: "Buyer",
  address_1: "1 Main St",
  city: "Atlanta",
  postal_code: "30301",
  country_code: "us",
}

type Session = { provider_id: string; status?: string }

const TOTAL = 500

/**
 * A cart through the address and shipping steps, with the given payment
 * sessions, each opened for the cart's total as the backend opens them.
 */
function cartWith(sessions: Session[]) {
  return {
    id: "cart_1",
    email: "buyer@example.com",
    total: TOTAL,
    currency_code: "usd",
    items: [],
    shipping_address: address,
    billing_address: address,
    shipping_methods: [{ id: "sm_1" }],
    payment_collection: {
      id: "pay_col_1",
      payment_sessions: sessions.map((session, i) => ({
        id: `payses_${i}`,
        status: "pending",
        amount: TOTAL,
        data: { id: `pi_${i}`, client_secret: `pi_${i}_secret_x` },
        ...session,
      })),
    },
    // The fields the components read, not a whole StoreCart.
  } as unknown as HttpTypes.StoreCart
}

/** Says whether the Stripe Elements provider is mounted where the page's children render. */
const ElementsProbe = () => <i data-elements={useContext(StripeContext) ? "mounted" : "absent"} />

/** The checkout page's own nesting: the wrapper around the payment step and the review step's button. */
function checkout(cart: ReturnType<typeof cartWith>, methods: string[]) {
  return renderToStaticMarkup(
    <PaymentWrapper cart={cart}>
      <ElementsProbe />
      <CartPaymentSection cart={cart} availablePaymentMethods={methods.map((id) => ({ id }))} />
      <PaymentButton cart={cart} data-testid="submit-order-button" />
    </PaymentWrapper>
  )
}

const CARD_FORM = "Enter your card details:"
const PLACE_ORDER = "Place order"
const NO_METHOD = "Select a payment method"
const AMOUNT_CHANGED = 'data-testid="stripe-payment-amount-changed"'

describe("checkout with a card session on the backend's Stripe provider", () => {
  it("mounts Stripe Elements, draws the card form and offers Place order", () => {
    const html = checkout(cartWith([{ provider_id: CARD }]), [CARD, MANUAL])

    expect(html).toContain('data-elements="mounted"')
    expect(html).toContain(CARD_FORM)
    expect(html).toContain(PLACE_ORDER)
    expect(html).not.toContain(NO_METHOD)
    // The session is for the cart's total, so nothing stands in the way.
    expect(html).not.toContain(AMOUNT_CHANGED)
    // The method reads as a card, not as a raw provider id.
    expect(html).toContain("Credit card")
    expect(html).not.toContain(`>${CARD}<`)
  })

  it("opens the card session as soon as the buyer picks the card method", async () => {
    checkout(cartWith([]), [CARD, MANUAL])
    expect(radioGroup.onChange).toBeInstanceOf(Function)

    await radioGroup.onChange?.(CARD)

    // The session is what carries the client secret Elements needs; without
    // it the card form cannot appear.
    expect(initiatePaymentSession).toHaveBeenCalledTimes(1)
    expect(initiatePaymentSession.mock.calls[0]).toMatchObject([{ id: "cart_1" }, { provider_id: CARD }])
  })

  it("does not throw on the review step when Elements is not mounted", () => {
    // Elements is mounted only around a pending card session; the Stripe
    // button's hooks throw outside it. A session already authorized by an
    // attempt that did not finish is the case that reaches this.
    const authorized = cartWith([{ provider_id: CARD, status: "authorized" }])
    const html = checkout(authorized, [CARD])

    expect(html).toContain('data-elements="absent"')
    expect(html).toContain(NO_METHOD)
    expect(html).not.toContain(PLACE_ORDER)

    // The button on its own, as CartReview renders it, with no wrapper at all.
    const bare = renderToStaticMarkup(<PaymentButton cart={cartWith([{ provider_id: CARD }])} data-testid="submit-order-button" />)
    expect(bare).toContain(NO_METHOD)
  })
})

describe("checkout with the manual provider", () => {
  it("offers Place order with no card form and no Stripe Elements", () => {
    const html = checkout(cartWith([{ provider_id: MANUAL }]), [CARD, MANUAL])

    expect(html).toContain('data-elements="absent"')
    expect(html).not.toContain(CARD_FORM)
    expect(html).toContain(PLACE_ORDER)
    expect(html).not.toContain(NO_METHOD)
  })

  it("opens no session when the method is picked; the Continue button does", async () => {
    checkout(cartWith([]), [CARD, MANUAL])
    await radioGroup.onChange?.(MANUAL)
    expect(initiatePaymentSession).not.toHaveBeenCalled()
  })
})

describe.each(NOT_CARDS)("checkout with %s (%s)", (_what, providerId) => {
  it("is not given the card form, Stripe Elements or a pay button", () => {
    const html = checkout(cartWith([{ provider_id: providerId }]), [providerId])

    expect(html).toContain('data-elements="absent"')
    expect(html).not.toContain(CARD_FORM)
    expect(html).not.toContain(PLACE_ORDER)
    expect(html).toContain(NO_METHOD)
  })

  it("opens no card session when picked", async () => {
    checkout(cartWith([]), [providerId])
    await radioGroup.onChange?.(providerId)
    expect(initiatePaymentSession).not.toHaveBeenCalled()
  })
})

// No page renders OrderShipping: the confirmation page has it inside a JSX
// comment (OrderConfirmedSection.tsx) and shows only the thank-you text and
// the email. This holds the component to the card provider's id for the day
// it is mounted; it says nothing about what a buyer sees after paying.
describe("OrderShipping, which no page mounts", () => {
  it("would name a card payment on the backend's Stripe provider", () => {
    const order = {
      currency_code: "usd",
      email: "buyer@example.com",
      shipping_address: address,
      shipping_methods: [{ name: "Pickup", total: 0 }],
      payment_collections: [{ payments: [{ provider_id: CARD }] }],
    } as unknown as HttpTypes.StoreOrder

    const html = renderToStaticMarkup(<OrderShipping order={order} />)
    expect(html).toMatch(/data-testid="payment-method"[^>]*>Credit card</)
  })
})
