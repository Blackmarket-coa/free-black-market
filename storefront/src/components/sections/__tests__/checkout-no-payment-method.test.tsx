import type { HttpTypes } from "@medusajs/types"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The payment step for a region that lists no payment method this build
 * offers.
 *
 * A region whose only provider is Medusa's manual one (the seed scripts make
 * exactly that) drew "Payment 0 Continue to review" in a production build:
 * the list was empty, and `list?.length && (…)` renders the 0.
 *
 * A server render of the real components, as in checkout-card-payment.test.tsx.
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

/** What a buyer reads: the markup's text, tags dropped. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()


describe("a region with no payment method this build offers", () => {
  it("says so and tells the buyer to contact the store, with no stray 0 where the list should be", () => {
    // What `listCartPaymentMethods` hands a production build for a region
    // listing only `pp_system_default`: an empty list.
    const html = checkout(cartWith(25, [plainLine]), [])
    const text = textOf(html)

    expect(html).toContain('data-testid="payment-no-methods"')
    expect(text).toContain("No payment method is available for this order. Please contact the store.")
    expect(text).not.toMatch(/Payment 0/)
    expect(text).not.toMatch(/(^| )0( |$)/)
    expect(h.radioGroup.onChange).toBeUndefined()
    expect(h.buttons["Continue to review"]?.disabled).toBe(true)
  })

  it("says the list could not be loaded when the fetch failed", () => {
    const text = textOf(checkout(cartWith(25, [plainLine]), null))

    expect(text).toContain("We couldn't load the payment methods. Refresh the page to try again.".replace("'", "&#x27;"))
    expect(text).not.toMatch(/No payment method is available/)
  })
})
