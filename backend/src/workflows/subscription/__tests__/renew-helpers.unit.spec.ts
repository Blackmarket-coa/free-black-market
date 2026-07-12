import {
  buildRenewalCartInput,
  buildRenewalPaymentContext,
  buildRenewalPaymentSessionInput,
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
    expect(input.metadata).toEqual({ subscription_id: "sub_1", renewal: true })
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
    expect(input.metadata).toEqual({ subscription_id: "sub_x", renewal: true })
  })
})

describe("buildRenewalPaymentContext", () => {
  it("marks the charge off-session and carries the saved payment method", () => {
    const ctx = buildRenewalPaymentContext(baseSubscription())
    expect(ctx).toEqual({
      off_session: true,
      subscription_id: "sub_1",
      payment_method_id: "pm_1",
      stripe_subscription_id: "stripe_sub_1",
    })
  })

  it("omits payment/stripe ids when absent", () => {
    const ctx = buildRenewalPaymentContext({ id: "sub_2", customer_id: "cus_2" })
    expect(ctx.off_session).toBe(true)
    expect(ctx.payment_method_id).toBeUndefined()
    expect(ctx.stripe_subscription_id).toBeUndefined()
  })
})

describe("buildRenewalPaymentSessionInput", () => {
  it("wires the payment collection, default provider, customer and off-session context", () => {
    const input = buildRenewalPaymentSessionInput({
      payment_collection_id: "paycol_1",
      subscription: baseSubscription(),
    })

    expect(input.payment_collection_id).toBe("paycol_1")
    expect(input.provider_id).toBe(SUBSCRIPTION_PAYMENT_PROVIDER_ID)
    expect(input.customer_id).toBe("cus_1")
    expect(input.context).toMatchObject({ off_session: true, payment_method_id: "pm_1" })
    expect(input.data).toMatchObject({ off_session: true, subscription_id: "sub_1" })
  })

  it("honors an explicit provider override", () => {
    const input = buildRenewalPaymentSessionInput({
      payment_collection_id: "paycol_1",
      subscription: baseSubscription(),
      provider_id: "pp_custom_custom",
    })
    expect(input.provider_id).toBe("pp_custom_custom")
  })
})
