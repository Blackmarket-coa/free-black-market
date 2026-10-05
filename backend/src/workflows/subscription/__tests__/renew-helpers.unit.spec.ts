import {
  buildRenewalCartInput,
  buildRenewalRecordSessionInput,
  RENEWAL_RECORD_PROVIDER_ID,
  SUBSCRIPTION_PAYMENT_PROVIDER_ID,
  type RenewalSubscription,
} from "../renew-helpers"

const baseSubscription = (): RenewalSubscription => ({
  id: "sub_1",
  customer_id: "cus_1",
  quantity: 2,
  payment_method_id: "pm_1",
  stripe_subscription_id: "stripe_sub_1",
  cart: {
    region_id: "reg_1",
    sales_channel_id: "sc_1",
    email: "member@example.com",
    currency_code: "usd",
    shipping_address: { id: "addr_ship", first_name: "Ada", city: "Portland" },
    billing_address: { id: "addr_bill", first_name: "Ada", city: "Portland" },
    items: [
      { variant_id: "var_1", quantity: 1, unit_price: 1500, title: "CSA box" },
      { variant_id: "var_2", quantity: 1, unit_price: 500, title: "Add-on" },
    ],
  },
})

describe("buildRenewalCartInput", () => {
  it("clones region/customer/channel/email/currency from the template cart", () => {
    const input = buildRenewalCartInput(baseSubscription())

    expect(input.region_id).toBe("reg_1")
    expect(input.customer_id).toBe("cus_1")
    expect(input.sales_channel_id).toBe("sc_1")
    expect(input.email).toBe("member@example.com")
    expect(input.currency_code).toBe("usd")
    expect(input.metadata).toEqual({
      subscription_id: "sub_1",
      renewal: true,
      order_channel: "subscription",
    })
  })

  it("strips address ids so fresh address rows are created", () => {
    const input = buildRenewalCartInput(baseSubscription())

    expect(input.shipping_address).toEqual({ first_name: "Ada", city: "Portland" })
    expect(input.billing_address).toEqual({ first_name: "Ada", city: "Portland" })
    expect((input.shipping_address as Record<string, unknown>).id).toBeUndefined()
  })

  it("applies the subscription quantity to every line item and tags renewals", () => {
    const input = buildRenewalCartInput(baseSubscription())

    expect(input.items).toHaveLength(2)
    expect(input.items[0]).toEqual({
      variant_id: "var_1",
      quantity: 2,
      unit_price: 1500,
      title: "CSA box",
      metadata: { subscription_renewal: true },
    })
  })

  it("falls back to item quantity (then 1) when the subscription has none", () => {
    const sub = baseSubscription()
    sub.quantity = null
    sub.cart!.items = [
      { variant_id: "var_1", quantity: 3, unit_price: 100, title: "x" },
      { variant_id: "var_2", quantity: null, unit_price: 100, title: "y" },
    ]

    const input = buildRenewalCartInput(sub)
    expect(input.items[0].quantity).toBe(3)
    expect(input.items[1].quantity).toBe(1)
  })

  it("drops line items with no variant id", () => {
    const sub = baseSubscription()
    sub.cart!.items = [
      { variant_id: "var_1", quantity: 1, unit_price: 100, title: "x" },
      { variant_id: null, quantity: 1, unit_price: 100, title: "orphan" },
    ]

    const input = buildRenewalCartInput(sub)
    expect(input.items).toHaveLength(1)
    expect(input.items[0].variant_id).toBe("var_1")
  })

  it("tolerates a subscription with no template cart", () => {
    const input = buildRenewalCartInput({ id: "sub_x", customer_id: "cus_x" })
    expect(input.items).toEqual([])
    expect(input.region_id).toBeUndefined()
    expect(input.shipping_address).toBeUndefined()
    expect(input.metadata).toEqual({
      subscription_id: "sub_x",
      renewal: true,
      order_channel: "subscription",
    })
  })
})

/**
 * The live renewal no longer asks the Medusa Stripe provider to charge: the
 * old `buildRenewalPaymentContext` sent `payment_method_id` + `off_session`,
 * keys the installed provider ignores (it reads `payment_method`/`confirm`,
 * stripe-base.js:49-51), and its spec asserted the ignored key — a passing
 * test that proved nothing about a charge. Money is now collected by the
 * direct PaymentIntent in `renewal-charge.ts` (see renewal-charge.unit.spec.ts);
 * the order gets a bookkeeping session on the system provider.
 */
describe("buildRenewalRecordSessionInput", () => {
  it("records the direct charge on a system-provider session, never the Stripe provider", () => {
    const input = buildRenewalRecordSessionInput({
      payment_collection_id: "paycol_1",
      subscription_id: "sub_1",
      payment_intent_id: "pi_1",
      idempotency_key: "subscription-renewal:sub_1:2026-11-01T00:00:00.000Z:a0",
    })

    expect(RENEWAL_RECORD_PROVIDER_ID).toBe("pp_system_default")
    expect(input.provider_id).toBe(RENEWAL_RECORD_PROVIDER_ID)
    expect(input.provider_id).not.toBe(SUBSCRIPTION_PAYMENT_PROVIDER_ID)
    expect(input).toEqual({
      payment_collection_id: "paycol_1",
      provider_id: "pp_system_default",
      data: {
        collected_by: "subscription_renewal_payment_intent",
        subscription_id: "sub_1",
        stripe_payment_intent_id: "pi_1",
        renewal_idempotency_key:
          "subscription-renewal:sub_1:2026-11-01T00:00:00.000Z:a0",
      },
    })
  })

  it("carries no off-session or payment-method keys a provider could act on", () => {
    const input = buildRenewalRecordSessionInput({
      payment_collection_id: "paycol_1",
      subscription_id: "sub_1",
      payment_intent_id: "pi_1",
      idempotency_key: "k",
    }) as { data: Record<string, unknown> }
    for (const key of ["payment_method", "payment_method_id", "off_session", "confirm"]) {
      expect(input.data).not.toHaveProperty(key)
    }
  })
})
