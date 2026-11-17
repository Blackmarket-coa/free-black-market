import { readFileSync } from "fs"
import path from "path"
import type { HttpTypes } from "@medusajs/types"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The delivery step and Place order on a cart with two sellers.
 *
 * Mercur's checkout needs one shipping method per seller and refuses the cart
 * otherwise, with 400 "Seller shipping method not found!", after it has
 * authorized the card (measured by the checkout scout on Postgres). Both
 * buttons used to ask for one method in all. And once a seller has a method,
 * Mercur stops listing that seller's options, so the step's type selector
 * (forced to Shipping by an effect on every render) could leave a seller
 * whose only option is Pickup with nothing to choose.
 *
 * The real `CartShippingMethodsSection` and `PaymentButton`, rendered to
 * markup: the storefront's vitest has no DOM library, so hooks run and effects
 * do not, and what is asserted is the first paint for a cart in a given
 * state. The rule itself (which seller still needs a method, which type is
 * shown after a pick) is lib/helpers/seller-shipping.ts, tested beside it; a
 * buyer's click and the re-render after it would need a DOM library.
 */

const h = vi.hoisted(() => ({
  step: "step=delivery",
  setShippingMethod: vi.fn(async () => ({ ok: true })),
  checkDeliveryForPostalCode: vi.fn(),
  buttons: {} as Record<string, { disabled?: boolean; loading?: boolean } | undefined>,
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(h.step),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/us/checkout",
  useParams: () => ({ locale: "us" }),
}))

vi.mock("@/lib/data/cart", () => ({
  setShippingMethod: h.setShippingMethod,
  removeShippingMethod: vi.fn(),
  initiatePaymentSession: vi.fn(),
  refreshCardPaymentSession: vi.fn(),
  placeOrder: vi.fn(),
  placeTicketOrder: vi.fn(),
}))
vi.mock("@/lib/data/fulfillment", () => ({ calculatePriceForShippingOption: vi.fn() }))
vi.mock("@/lib/data/delivery", () => ({ checkDeliveryForPostalCode: h.checkDeliveryForPostalCode }))
vi.mock("@/lib/data/subscriptions", () => ({ completeSubscriptionCheckout: vi.fn() }))
// Reached only through the atoms barrel (LogoutButton); a server action.
vi.mock("@/lib/data/customer", () => ({ signout: vi.fn() }))

vi.mock("@/components/atoms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/atoms")>()
  const { createElement } = await import("react")
  return {
    ...actual,
    // The real button, rendered as it is; this only remembers what each was given.
    Button: (props: React.ComponentProps<typeof actual.Button>) => {
      if (typeof props.children === "string") h.buttons[props.children] = props
      return createElement(actual.Button, props)
    },
  }
})

// The storefront's vitest compiles JSX to the classic `React.createElement`.
;(globalThis as { React?: typeof React }).React = React

type Section = typeof import("../CartShippingMethodsSection/CartShippingMethodsSection").default
type PayButton = typeof import("../CartReview/PaymentButton").default
let CartShippingMethodsSection: Section
let PaymentButton: PayButton

beforeAll(async () => {
  CartShippingMethodsSection = (await import("../CartShippingMethodsSection/CartShippingMethodsSection")).default
  PaymentButton = (await import("../CartReview/PaymentButton")).default
})

beforeEach(() => {
  h.step = "step=delivery"
  h.buttons = {}
})

const A = { id: "sel_a", name: "Grower A" }
const B = { id: "sel_b", name: "Grower B" }

const address = {
  first_name: "Ada",
  last_name: "Buyer",
  address_1: "1 Main St",
  city: "Atlanta",
  postal_code: "30301",
  country_code: "us",
}

/** A cart with a line from each seller given, and a method for each option id given. */
function cartWith(sellers: Array<{ id: string; name: string }>, methodOptionIds: string[]) {
  return {
    id: "cart_1",
    email: "buyer@example.com",
    currency_code: "usd",
    total: 32,
    shipping_address: address,
    billing_address: address,
    items: sellers.map((seller, i) => ({ id: `li_${i}`, product: { id: `prod_${i}`, seller } })),
    shipping_methods: methodOptionIds.map((shipping_option_id, i) => ({
      id: `sm_${i}`,
      shipping_option_id,
      name: `Method ${shipping_option_id}`,
      amount: 5,
    })),
    payment_collection: null,
    // The fields the components read, not a whole StoreCart.
  } as unknown as HttpTypes.StoreCart
}

/** An option as Mercur lists it: flat-priced, its seller named, and its fulfillment set's type. */
const option = (id: string, seller: { id: string; name: string }, type: "shipping" | "pickup" | "delivery") => ({
  id,
  name: `${type} by ${seller.name}`,
  price_type: "flat",
  amount: 5,
  seller_id: seller.id,
  seller_name: seller.name,
  service_zone: { fulfillment_set: { type } },
})

function deliveryStep(cart: HttpTypes.StoreCart, offered: ReturnType<typeof option>[]) {
  return renderToStaticMarkup(
    <CartShippingMethodsSection
      cart={cart as Parameters<Section>[0]["cart"]}
      availableShippingMethods={offered as Parameters<Section>[0]["availableShippingMethods"]}
    />
  )
}

const CONTINUE = "Continue to payment"

describe("the delivery step", () => {
  it("keeps Continue to payment shut on the measured cart, two sellers and a method for one, and names the other", () => {
    const html = deliveryStep(cartWith([A, B], ["so_a"]), [option("so_b", B, "shipping")])

    expect(h.buttons[CONTINUE]?.disabled).toBe(true)
    expect(html).toContain("Choose a delivery option for Grower B to continue.")
  })

  it("opens Continue to payment once every seller has a method", () => {
    const html = deliveryStep(cartWith([A, B], ["so_a", "so_b"]), [])

    expect(h.buttons[CONTINUE]?.disabled).toBe(false)
    expect(html).not.toContain("Choose a delivery option for")
    // Both picks stay in view, each with its remove button, though Mercur
    // now lists nothing to choose from.
    expect(html).toContain('data-testid="selected-delivery-options"')
    expect(html).toContain("Method so_a")
    expect(html).toContain("Method so_b")
  })

  it("shows the Pickup options of a remaining seller who offers only Pickup, after the other seller's Shipping pick", () => {
    const html = deliveryStep(cartWith([A, B], ["so_a"]), [option("so_b_pickup", B, "pickup")])

    // The Pickup choice is shown, and Grower B's list with it.
    expect(html).toContain('data-testid="delivery-options-container"')
    expect(html).toContain("Choose pickup option")
    expect(html).toContain("Grower B")
    expect(html).not.toContain("No shipping options available")
    expect(h.buttons[CONTINUE]?.disabled).toBe(true)
  })

  it("says which seller has no option for the address, and how to go on, instead of a commented-out notice", () => {
    const html = deliveryStep(cartWith([A, B], []), [option("so_a", A, "shipping")])

    expect(html).toContain('data-testid="sellers-without-delivery-options"')
    expect(html).toContain("Grower B has no delivery options for this address.")
    expect(html).toContain("To check out, remove that seller&#x27;s items from")
    expect(html).not.toMatch(/contact (him|them)/)
    expect(h.buttons[CONTINUE]?.disabled).toBe(true)
  })

  it("asks the backend nothing from the browser: the eligibility check is a server action", () => {
    const source = readFileSync(
      path.join(__dirname, "../CartShippingMethodsSection/CartShippingMethodsSection.tsx"),
      "utf8"
    )
    expect(source).not.toMatch(/delivery-zones\/check/)
    expect(source).not.toMatch(/NEXT_PUBLIC_MEDUSA_BACKEND_URL/)
    expect(source).toContain("checkDeliveryForPostalCode")
  })
})

describe("Place order", () => {
  const ready = (cart: HttpTypes.StoreCart) => ({
    ...cart,
    // A manual session: its button renders without Stripe Elements. Only a
    // development build offers one (lib/constants/payment-providers.ts).
    payment_collection: { id: "pay_col_1", payment_sessions: [{ id: "ps_1", provider_id: "pp_system_default", status: "pending", amount: 32 }] },
  }) as unknown as HttpTypes.StoreCart

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("waits on the measured cart and says which seller still needs a delivery option", () => {
    const html = renderToStaticMarkup(
      <PaymentButton
        cart={ready(cartWith([A, B], ["so_a"]))}
        shippingOptions={[option("so_b", B, "shipping")]}
        data-testid="submit-order-button"
      />
    )

    expect(h.buttons["Place order"]?.disabled).toBe(true)
    expect(html).toContain("Choose a delivery option for Grower B before placing your order.")
  })

  it("waits without the listed options too: one method for two sellers is not enough", () => {
    const html = renderToStaticMarkup(
      <PaymentButton cart={ready(cartWith([A, B], ["so_a"]))} data-testid="submit-order-button" />
    )

    expect(h.buttons["Place order"]?.disabled).toBe(true)
    expect(html).toContain('data-testid="shipping-incomplete-note"')
  })

  it("is offered once every seller has a method", () => {
    const html = renderToStaticMarkup(
      <PaymentButton cart={ready(cartWith([A, B], ["so_a", "so_b"]))} shippingOptions={[]} data-testid="submit-order-button" />
    )

    expect(h.buttons["Place order"]?.disabled).toBe(false)
    expect(html).not.toContain('data-testid="shipping-incomplete-note"')
  })
})
