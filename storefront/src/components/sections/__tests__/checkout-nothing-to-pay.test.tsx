import type { HttpTypes } from "@medusajs/types"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The payment and review steps for a cart that owes nothing.
 *
 * A $0 cart had no way through a production checkout. Picking the card asks
 * the backend for a session of zero, which Stripe refuses (by its documented
 * minimum charge), so the buyer read "We could not start the card payment"
 * on every try; Medusa's manual provider was the one way to a Place order
 * button, and a production build no longer offers it. What the backend does
 * with such a cart (lib/helpers/nothing-to-pay.ts): the main checkout answers
 * 409 `cart_nothing_to_pay`; the ticket checkout completes it with no payment
 * session (measured on Postgres).
 *
 * A server render of the real components, as in checkout-card-payment.test.tsx.
 * The empty list of methods is checkout-no-payment-method.test.tsx.
 */

const h = vi.hoisted(() => {
  // PaymentWrapper reads the key once, when the module loads.
  process.env.NEXT_PUBLIC_STRIPE_KEY = "pk_test_checkout_render_spec"
  return {
    initiatePaymentSession: vi.fn(async () => ({})),
    placeOrder: vi.fn(async () => ({ ok: true })),
    placeTicketOrder: vi.fn(async (): Promise<unknown> => ({ ok: true })),
    push: vi.fn(),
    radioGroup: { onChange: undefined as undefined | ((value: string) => unknown) },
    buttons: {} as Record<string, { disabled?: boolean; onClick?: () => unknown } | undefined>,
  }
})

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("step=payment"),
  useRouter: () => ({ push: h.push }),
  usePathname: () => "/us/checkout",
}))

vi.mock("@/lib/data/cart", () => ({
  initiatePaymentSession: h.initiatePaymentSession,
  refreshCardPaymentSession: vi.fn(),
  placeOrder: h.placeOrder,
  placeTicketOrder: h.placeTicketOrder,
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
    // The real button, rendered as it is; this only remembers what each was given.
    Button: (props: React.ComponentProps<typeof actual.Button>) => {
      if (typeof props.children === "string") h.buttons[props.children.trim()] = props as (typeof h.buttons)[string]
      return createElement(actual.Button, props)
    },
  }
})

// The storefront's vitest compiles JSX to the classic `React.createElement`.
;(globalThis as { React?: typeof React }).React = React

let CartPaymentSection: typeof import("../CartPaymentSection/CartPaymentSection").default
let PaymentButton: typeof import("../CartReview/PaymentButton").default
let PaymentWrapper: typeof import("../../organisms/PaymentContainer/PaymentWrapper").default

beforeAll(async () => {
  CartPaymentSection = (await import("../CartPaymentSection/CartPaymentSection")).default
  PaymentButton = (await import("../CartReview/PaymentButton")).default
  PaymentWrapper = (await import("../../organisms/PaymentContainer/PaymentWrapper")).default
})

beforeEach(() => {
  vi.clearAllMocks()
  h.radioGroup.onChange = undefined
  h.buttons = {}
})

const CARD = "pp_stripe_stripe"
const address = { first_name: "Ada", last_name: "Buyer", address_1: "1 Main St", city: "Atlanta", postal_code: "30301", country_code: "us" }
const ticketLine = { id: "li_t", metadata: { show_date: "2027-03-14", venue_row_id: "row_1", seat_number: "7" } }
const plainLine = { id: "li_p", metadata: {} }

type Session = { provider_id: string; status?: string; amount?: number }

/** A cart through the address and delivery steps, with the total, lines and payment sessions given. */
function cartWith(total: number, items: Array<{ id: string; metadata: Record<string, unknown> }>, sessions: Session[] | null = null) {
  return {
    id: "cart_1",
    email: "buyer@example.com",
    total,
    currency_code: "usd",
    items,
    shipping_address: address,
    billing_address: address,
    shipping_methods: [{ id: "sm_1" }],
    payment_collection: sessions
      ? {
          id: "pay_col_1",
          payment_sessions: sessions.map((session, i) => ({
            id: `payses_${i}`,
            status: "pending",
            amount: total,
            data: { id: `pi_${i}`, client_secret: `pi_${i}_secret_x` },
            ...session,
          })),
        }
      : null,
    // The fields the components read, not a whole StoreCart.
  } as unknown as HttpTypes.StoreCart
}

/** The checkout page's own nesting: the wrapper around the payment step and the review step's button. */
function checkout(cart: HttpTypes.StoreCart, methods: string[] | null) {
  return renderToStaticMarkup(
    <PaymentWrapper cart={cart}>
      <CartPaymentSection cart={cart} availablePaymentMethods={methods && methods.map((id) => ({ id }))} />
      <PaymentButton cart={cart} data-testid="submit-order-button" />
    </PaymentWrapper>
  )
}

const NOT_PLACEABLE = "orders with nothing to pay can&#x27;t be placed yet"
const NO_METHOD_NEEDED = "so no payment method is needed"
const CARD_FORM = "Enter your card details:"

describe("a cart that owes nothing and is not all tickets", () => {
  it("is offered no payment method, opens no session, and says it cannot be placed yet, on both steps", async () => {
    const html = checkout(cartWith(0, [plainLine]), [CARD])

    // No method to pick, so nothing can ask Stripe for a session of zero.
    expect(h.radioGroup.onChange).toBeUndefined()
    expect(html).not.toContain("Credit card")
    expect(html).toContain('data-testid="payment-nothing-to-pay"')
    expect(html).toContain('data-testid="nothing-to-pay-not-placeable"')
    expect(html.match(new RegExp(NOT_PLACEABLE, "g"))).toHaveLength(2)
    expect(html).not.toContain(NO_METHOD_NEEDED)

    expect(h.buttons["Continue to review"]?.disabled).toBe(true)
    expect(h.buttons["Place order"]?.disabled).toBe(true)
    await h.buttons["Continue to review"]?.onClick?.()
    expect(h.initiatePaymentSession).not.toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
  })

  it("does not draw the card form or a pay button on a card session an earlier total left behind", () => {
    const html = checkout(cartWith(0, [plainLine], [{ provider_id: CARD, amount: 20 }]), [CARD])

    expect(html).not.toContain(CARD_FORM)
    expect(html).toContain('data-testid="nothing-to-pay-not-placeable"')
    expect(h.buttons["Place order"]?.disabled).toBe(true)
    expect(html).not.toContain('data-testid="stripe-payment-update"')
  })
})

describe("an all-ticket cart that owes nothing", () => {
  it("needs no payment method: Continue to review goes on without opening a session", async () => {
    const html = checkout(cartWith(0, [ticketLine]), [CARD])

    expect(h.radioGroup.onChange).toBeUndefined()
    expect(html).toContain(NO_METHOD_NEEDED)
    expect(html).not.toContain(NOT_PLACEABLE)
    expect(h.buttons["Continue to review"]?.disabled).toBe(false)

    await h.buttons["Continue to review"]?.onClick?.()

    expect(h.initiatePaymentSession).not.toHaveBeenCalled()
    expect(h.push).toHaveBeenCalledTimes(1)
    expect(h.push.mock.calls[0][0]).toBe("/us/checkout?step=review")
  })

  it("places its order through the ticket checkout, with no payment session", async () => {
    checkout(cartWith(0, [ticketLine]), [CARD])

    expect(h.buttons["Place order"]?.disabled).toBe(false)
    await h.buttons["Place order"]?.onClick?.()

    expect(h.placeTicketOrder).toHaveBeenCalledTimes(1)
    expect(h.placeOrder).not.toHaveBeenCalled()
    expect(h.initiatePaymentSession).not.toHaveBeenCalled()
  })

  it("still waits for the address and a delivery option", () => {
    const cart = { ...cartWith(0, [ticketLine]), shipping_methods: [] } as unknown as HttpTypes.StoreCart
    checkout(cart, [CARD])

    expect(h.buttons["Place order"]?.disabled).toBe(true)
  })
})

describe("a cart that owes money", () => {
  it("is still asked for a payment method", () => {
    const html = checkout(cartWith(25, [plainLine]), [CARD])

    expect(h.radioGroup.onChange).toBeInstanceOf(Function)
    expect(html).toContain("Credit card")
    expect(html).not.toContain('data-testid="payment-nothing-to-pay"')
    expect(html).not.toContain('data-testid="nothing-to-pay-not-placeable"')
  })
})
