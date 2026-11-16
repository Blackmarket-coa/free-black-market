import type { HttpTypes } from "@medusajs/types"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * What the checkout does when a card payment cannot go ahead.
 *
 * Two cases, both on paths that were dead while the checkout knew no card
 * provider (see checkout-card-payment.test.tsx, beside this file):
 *
 * - The card session will not open. Picking the card is what opens it; a
 *   failure there used to escape as an unhandled rejection, with the card
 *   left looking picked, no card form, no message, and no way to pick it
 *   again (the radio group ignores a click on the method already picked).
 * - The session was opened for an amount that is no longer the cart's total.
 *   Stripe charges the session's amount, not the total on the page.
 *
 * And the case that is not a refusal: the backend refreshed the cart's
 * payment after the total changed (SD-115), so the page has no card session
 * and the buyer chooses the payment method again.
 *
 * Same harness as the other file: a server render of the real components, so
 * hooks run and effects do not. Two things are replaced here that are real
 * there, because nothing after the first paint can be seen otherwise:
 *
 * - `useState` is the real one, with every later update written down. A
 *   server render does not paint again, so "the section now holds an error"
 *   is read off what it set, not off markup. For the pay button it also
 *   starts one state where an effect would have left it (`cardEntered`,
 *   below).
 * - `useStripe` and `useElements` hand back a Stripe that has loaded and a
 *   card that is complete. On a server the real ones never load, and the pay
 *   button would refuse for that reason alone, proving nothing about amounts.
 *   The `Elements` provider around them is still the real one.
 */

const h = vi.hoisted(() => {
  // PaymentWrapper reads the key once, when the module loads.
  process.env.NEXT_PUBLIC_STRIPE_KEY = "pk_test_checkout_render_spec"
  return {
    initiatePaymentSession: vi.fn(async (): Promise<unknown> => ({})),
    placeOrder: vi.fn(async () => ({ ok: true })),
    confirmCardPayment: vi.fn(async (): Promise<unknown> => ({ paymentIntent: { status: "requires_capture" } })),
    radioGroup: { onChange: undefined as undefined | ((value: string) => unknown) },
    payButton: { props: undefined as undefined | { disabled?: boolean; onClick?: () => unknown } },
    stateUpdates: [] as unknown[],
    /**
     * The Stripe pay button starts disabled (`useState(true)`) and an effect
     * enables it once the card is complete. Effects do not run here, so with
     * this on, that state starts enabled, as the effect would leave it for
     * the complete card `useElements` hands back below. It is the only state
     * in the rendered tree that starts `true`; if another appears, this
     * switch needs a narrower aim.
     */
    cardEntered: false,
  }
})

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    useState: (initial: unknown) => {
      const [value, set] = actual.useState(h.cardEntered && initial === true ? false : initial)
      const recordingSet = (next: unknown) => {
        h.stateUpdates.push(next)
        set(next)
      }
      return [value, recordingSet]
    },
  }
})

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("step=payment"),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/us/checkout",
}))

vi.mock("@/lib/data/cart", () => ({
  initiatePaymentSession: h.initiatePaymentSession,
  placeOrder: h.placeOrder,
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
      h.radioGroup.onChange = props.onChange
      return createElement(actual.RadioGroup as React.ElementType, props)
    },
  }
})

vi.mock("@/components/atoms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/atoms")>()
  const { createElement } = await import("react")
  return {
    ...actual,
    // The real button, rendered as it is; this only remembers what the pay
    // button was given.
    Button: (props: React.ComponentProps<typeof actual.Button>) => {
      if (props.children === "Place order") h.payButton.props = props as typeof h.payButton.props
      return createElement(actual.Button, props)
    },
  }
})

vi.mock("@stripe/react-stripe-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stripe/react-stripe-js")>()
  const card = { _complete: true }
  return {
    ...actual,
    useStripe: () => ({ confirmCardPayment: h.confirmCardPayment }),
    useElements: () => ({ getElement: () => card }),
  }
})

// Classic JSX reads a global React; see the other file.
;(globalThis as { React?: typeof React }).React = React

type Section = typeof import("../CartPaymentSection/CartPaymentSection").default
type Button = typeof import("../CartReview/PaymentButton").default
type Wrapper = typeof import("../../organisms/PaymentContainer/PaymentWrapper").default

let CartPaymentSection: Section
let PaymentButton: Button
let PaymentWrapper: Wrapper

beforeAll(async () => {
  CartPaymentSection = (await import("../CartPaymentSection/CartPaymentSection")).default
  PaymentButton = (await import("../CartReview/PaymentButton")).default
  PaymentWrapper = (await import("../../organisms/PaymentContainer/PaymentWrapper")).default
})

beforeEach(() => {
  h.initiatePaymentSession.mockClear()
  h.placeOrder.mockClear()
  h.confirmCardPayment.mockClear()
  h.radioGroup.onChange = undefined
  h.payButton.props = undefined
  h.stateUpdates.length = 0
  h.cardEntered = false
})

const CARD = "pp_stripe_stripe"
const MANUAL = "pp_system_default"

const address = {
  first_name: "Ada",
  last_name: "Buyer",
  address_1: "1 Main St",
  city: "Atlanta",
  postal_code: "30301",
  country_code: "us",
}

type Session = { provider_id: string; amount?: number }

/** A cart through the address and shipping steps, at `total`, with the given pending sessions. */
function cartWith(total: number, sessions: Session[]) {
  return {
    id: "cart_1",
    email: "buyer@example.com",
    total,
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
        data: { id: `pi_${i}`, client_secret: `pi_${i}_secret_x` },
        ...session,
      })),
    },
    // The fields the components read, not a whole StoreCart.
  } as unknown as HttpTypes.StoreCart
}

/** The checkout page's own nesting: the wrapper around the payment step and the review step's button. */
function checkout(cart: ReturnType<typeof cartWith>, methods: string[]) {
  const html = renderToStaticMarkup(
    <PaymentWrapper cart={cart}>
      <CartPaymentSection cart={cart} availablePaymentMethods={methods.map((id) => ({ id }))} />
      <PaymentButton cart={cart} data-testid="submit-order-button" />
    </PaymentWrapper>
  )
  // Only what happens after the paint is of interest.
  h.stateUpdates.length = 0
  return html
}

const NOT_OPENED = "We could not start the card payment. Choose the payment method again to retry."
const AMOUNT_CHANGED =
  "Your order total changed after you chose how to pay, so your card has not been charged. Go back to Delivery and choose your delivery option again, then choose your payment method again to pay the current total."

describe("picking the card when its session cannot be opened", () => {
  const refuse = () => h.initiatePaymentSession.mockRejectedValueOnce(new Error("Stripe said no."))
  const takenBack = () => h.stateUpdates.filter((u): u is (current: string) => string => typeof u === "function")

  it("does not reject, says so, and takes the pick back so the card can be picked again", async () => {
    checkout(cartWith(20, []), [CARD, MANUAL])
    refuse()

    await expect(h.radioGroup.onChange?.(CARD)).resolves.toBeUndefined()

    expect(h.initiatePaymentSession).toHaveBeenCalledTimes(1)
    expect(h.stateUpdates).toContain(NOT_OPENED)
    // The backend's own message is not what the buyer is shown.
    expect(h.stateUpdates).not.toContain("Stripe said no.")

    const [reset, ...others] = takenBack()
    expect(others).toHaveLength(0)
    // Nothing is picked, so a click on the card is a change again.
    expect(reset(CARD)).toBe("")
    // A method picked while the card was still opening stays picked.
    expect(reset(MANUAL)).toBe(MANUAL)
  })

  it("goes back to the method the cart already has a session on", async () => {
    checkout(cartWith(20, [{ provider_id: MANUAL, amount: 20 }]), [CARD, MANUAL])
    refuse()

    await expect(h.radioGroup.onChange?.(CARD)).resolves.toBeUndefined()

    expect(h.stateUpdates).toContain(NOT_OPENED)
    expect(takenBack()[0](CARD)).toBe(MANUAL)
  })

  it("leaves nothing picked when the session that failed was a new one for the card itself", async () => {
    // The cart's card session may not have survived the failed attempt, and
    // the card left picked could not be clicked again.
    checkout(cartWith(20, [{ provider_id: CARD, amount: 20 }]), [CARD, MANUAL])
    refuse()

    await expect(h.radioGroup.onChange?.(CARD)).resolves.toBeUndefined()

    expect(takenBack()[0](CARD)).toBe("")
  })

  it("sets no error and takes nothing back when the session opens", async () => {
    checkout(cartWith(20, []), [CARD, MANUAL])

    await expect(h.radioGroup.onChange?.(CARD)).resolves.toBeUndefined()

    expect(h.initiatePaymentSession).toHaveBeenCalledTimes(1)
    expect(h.stateUpdates).toEqual([null, CARD])
  })
})

describe("after a delivery option changed and the backend refreshed the cart's payment", () => {
  // What the backend leaves once a write has changed the total
  // (backend/integration-tests/http/cart-payment-refresh.spec.ts): the
  // collection at the new total, and no session.
  const refreshed = () => cartWith(34, [])

  it("holds no card session: no card form, no notice about a changed total, and the review step asks for a payment method", () => {
    const html = checkout(refreshed(), [CARD])

    // Nothing of the session that was deleted is on the page: PaymentWrapper
    // mounts Stripe Elements, with a session's client secret, only around a
    // pending card session.
    expect(html).not.toContain("Enter your card details")
    expect(html).not.toContain(AMOUNT_CHANGED)
    expect(html).toContain("Select a payment method")
    // No "Place order" button was drawn, so nothing can be confirmed.
    expect(h.payButton.props).toBeUndefined()
  })

  it("opens a new card session for the cart as it now is when the buyer picks the card on the payment step", async () => {
    const cart = refreshed()
    checkout(cart, [CARD])

    await expect(h.radioGroup.onChange?.(CARD)).resolves.toBeUndefined()

    expect(h.initiatePaymentSession).toHaveBeenCalledTimes(1)
    expect(h.initiatePaymentSession).toHaveBeenCalledWith(cart, { provider_id: CARD })
    expect(h.stateUpdates).toEqual([null, CARD])
  })

  it("confirms the card with the new session's secret once that session is for the new total", async () => {
    h.cardEntered = true
    const html = checkout(cartWith(34, [{ provider_id: CARD, amount: 34 }]), [CARD])
    expect(html).not.toContain(AMOUNT_CHANGED)
    expect(h.payButton.props?.disabled).toBe(false)

    await h.payButton.props?.onClick?.()

    expect(h.confirmCardPayment).toHaveBeenCalledTimes(1)
    expect(h.confirmCardPayment).toHaveBeenCalledWith("pi_0_secret_x", expect.anything())
    expect(h.placeOrder).toHaveBeenCalledTimes(1)
  })
})

describe("the pay button when the card session is for another amount than the cart's total", () => {
  beforeEach(() => {
    h.cardEntered = true
  })

  it("confirms the card and places the order when the session is for the total", async () => {
    // The control: with these stand-ins the button is enabled and a click
    // does reach Stripe.
    const html = checkout(cartWith(20, [{ provider_id: CARD, amount: 20 }]), [CARD])
    expect(html).not.toContain(AMOUNT_CHANGED)
    expect(h.payButton.props?.disabled).toBe(false)

    await h.payButton.props?.onClick?.()

    expect(h.confirmCardPayment).toHaveBeenCalledTimes(1)
    expect(h.confirmCardPayment.mock.calls[0]).toMatchObject(["pi_0_secret_x", { payment_method: { billing_details: { email: "buyer@example.com" } } }])
    expect(h.placeOrder).toHaveBeenCalledTimes(1)
  })

  it("does not confirm the card, and says why, when the total dropped after the session was opened", async () => {
    // The reprice measured in review: a session opened at 20.00, a cart now at 13.00.
    const html = checkout(cartWith(13, [{ provider_id: CARD, amount: 20 }]), [CARD])

    expect(html).toContain(AMOUNT_CHANGED)
    expect(html).toContain('data-testid="stripe-payment-amount-changed"')
    expect(h.payButton.props?.disabled).toBe(true)

    await h.payButton.props?.onClick?.()

    expect(h.confirmCardPayment).not.toHaveBeenCalled()
    expect(h.placeOrder).not.toHaveBeenCalled()
  })

  it("does not confirm the card when the total rose, or when the session carries no amount", async () => {
    checkout(cartWith(25, [{ provider_id: CARD, amount: 20 }]), [CARD])
    expect(h.payButton.props?.disabled).toBe(true)
    await h.payButton.props?.onClick?.()

    const html = checkout(cartWith(20, [{ provider_id: CARD }]), [CARD])
    expect(html).toContain(AMOUNT_CHANGED)
    expect(h.payButton.props?.disabled).toBe(true)
    await h.payButton.props?.onClick?.()

    expect(h.confirmCardPayment).not.toHaveBeenCalled()
    expect(h.placeOrder).not.toHaveBeenCalled()
  })

  it("leaves the manual provider's button alone", () => {
    // It takes no money, so there is no amount to be wrong about.
    const html = checkout(cartWith(13, [{ provider_id: MANUAL, amount: 20 }]), [CARD, MANUAL])

    expect(html).toContain("Place order")
    expect(html).not.toContain(AMOUNT_CHANGED)
  })
})
