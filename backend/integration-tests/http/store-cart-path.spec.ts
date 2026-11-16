import fs from "fs"
import path from "path"
import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { addToCartWorkflow, createRegionsWorkflow, createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { cardOrderFixtures } from "./helpers/card-orders"
import { trackSubscribers } from "./helpers/drain-subscribers"
import { clearStalledWorkflows } from "./helpers/stalled-workflows"

jest.setTimeout(300 * 1000)

/**
 * SD-117: the buyer's whole cart path through the real routes, on Postgres,
 * with the calls and field lists the storefront sends.
 *
 * Medusa 2.14.2 is built against MikroORM 6.6.12; this repo pins 6.6.14 for a
 * CVE fix. 6.6.14 turns every nested path in a find's `fields` into a populate
 * hint, and Medusa's own cart, order and payment field lists name paths the
 * entity does not have (`shipping_address.region_code`, `items.variant`,
 * `payments.captures_id`). With the first version of
 * `scripts/patch-mikro-orm.js` those hints crashed further in, so:
 *
 *  - `POST /store/carts` for a region with exactly one country answered 500
 *    (Medusa presets the shipping address, and the tax step reads it back);
 *  - every read of a cart with an address, and every default-field read of a
 *    cart with a line, answered 500, and so did the routes that end in such a
 *    read after their write went through: add a line, change its quantity,
 *    set the addresses, and Mercur's add and remove shipping method;
 *  - `POST /admin/orders/:id/cancel` answered 500 for any paid order.
 *
 * No spec posted to `/store/carts` through the route, which is how it stayed
 * unseen: every other spec builds its cart through the cart module. The fix is
 * in the patch script (it only merges a path MikroORM can resolve);
 * `src/scripts/__tests__/patch-mikro-orm.unit.spec.ts` pins the script and the
 * planner, and this spec pins what a buyer sees. On a tree that does not carry
 * the fix, the first two tests fail at the first call that breaks and the
 * third lists every call that does.
 *
 * The storefront's field lists are read out of its source
 * (`storefront/src/lib/data/cart.ts`, `orders.ts`), so a change there is
 * tested here without anyone remembering to copy it.
 *
 * One fixture is not FBM's behaviour: the `order_set.display_id` trigger, for
 * the reason given in cart-completion-refuses.spec.ts.
 */

const STOREFRONT_DATA = path.resolve(__dirname, "../../../storefront/src/lib/data")

/**
 * The `fields` string a storefront function sends: the string literals that
 * follow the first `fields:` after `declaration`, joined as the source joins
 * them. Null when the storefront is not checked out beside the backend.
 */
function storefrontFields(file: string, declaration: string): string | null {
  const source = path.join(STOREFRONT_DATA, file)
  if (!fs.existsSync(source)) {
    // The backend is sometimes checked out on its own; in CI the whole repo
    // is there and a missing file must fail, never pass by skipping.
    if (process.env.CI) throw new Error(`storefront source not found at ${source}`)
    return null
  }
  const text = fs.readFileSync(source, "utf8")
  const from = text.indexOf(declaration)
  if (from < 0) throw new Error(`${file}: "${declaration}" not found; the storefront's query moved`)
  const literals = /fields:\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)/.exec(text.slice(from))
  if (!literals) throw new Error(`${file}: no fields literal after "${declaration}"`)
  return [...literals[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("")
}

const CART_FIELDS = storefrontFields("cart.ts", "export async function retrieveCart(")
const ORDER_FIELDS = storefrontFields("orders.ts", "export const retrieveOrder =")

const ADDRESS = {
  first_name: "Ada",
  last_name: "Buyer",
  address_1: "1 Main St",
  address_2: "",
  company: "",
  postal_code: "30301",
  city: "Atlanta",
  province: "",
  phone: "",
}

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const { container, uid, makeSeller } = cardOrderFixtures(getContainer)
    const run = CART_FIELDS && ORDER_FIELDS ? it : it.skip
    const cartFields = CART_FIELDS as string
    const orderFields = ORDER_FIELDS as string

    let drainSubscribers: () => Promise<void> = async () => {}
    beforeEach(() => {
      drainSubscribers = trackSubscribers(container)
    })
    afterEach(() => {
      jest.restoreAllMocks()
    })

    // Mercur 1.5.0's model writes NULL into its own serial column: give the
    // row the sequence's next value, as the column's default would. A
    // test-database fixture (see cart-completion-refuses.spec.ts).
    beforeAll(async () => {
      const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      await pg.raw(`
        CREATE OR REPLACE FUNCTION fbm_test_order_set_display_id() RETURNS trigger AS $$
        BEGIN
          IF NEW.display_id IS NULL THEN
            NEW.display_id := nextval(pg_get_serial_sequence('order_set', 'display_id'));
          END IF;
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS fbm_test_order_set_display_id ON order_set;
        CREATE TRIGGER fbm_test_order_set_display_id BEFORE INSERT ON order_set
          FOR EACH ROW EXECUTE FUNCTION fbm_test_order_set_display_id();
      `)
    })

    /** Before the runner's teardown: subscribers finished, no execution left unfinished. */
    async function settleBeforeTeardown() {
      await drainSubscribers()
      const stalled = await clearStalledWorkflows(container)
      if (stalled.length) {
        throw new Error(`Workflow executions left unfinished: ${stalled.map((w) => `${w.workflow_id} (${w.state})`).join(", ")}`)
      }
    }

    /**
     * A storefront as production has one: a publishable key on one sales
     * channel; a region with exactly one country (us) and one with two (ca,
     * mx), in dollars, taking the manual payment provider; and a seller whose
     * crate of tomatoes is $10.00 and whose flat shipping option, $5.00,
     * serves the US and Canada from a location that stocks the channel.
     */
    async function makeStorefront() {
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      const fulfillment = container().resolve(Modules.FULFILLMENT)
      const id = uid()

      const [channel] = await container().resolve(Modules.SALES_CHANNEL).createSalesChannels([{ name: `Storefront ${id}` }])
      const [key] = await container()
        .resolve(Modules.API_KEY)
        .createApiKeys([{ title: "storefront", type: "publishable", created_by: "test" }])
      await link.create({
        [Modules.API_KEY]: { publishable_key_id: key.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
      })
      const pak = { headers: { "x-publishable-api-key": key.token as string } }

      const region = async (name: string, countries: string[]) =>
        (
          await createRegionsWorkflow(container()).run({
            input: { regions: [{ name, currency_code: "usd", countries, payment_providers: ["pp_system_default"] }] },
          })
        ).result[0] as { id: string }
      const oneCountry = await region(`United States ${id}`, ["us"])
      const twoCountries = await region(`North ${id}`, ["ca", "mx"])

      const [location] = await container().resolve(Modules.STOCK_LOCATION).createStockLocations([{ name: `Farm ${id}` }])
      await link.create({
        [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      })
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
      })
      const set = await fulfillment.createFulfillmentSets({
        name: `Delivery ${id}`,
        type: "shipping",
        service_zones: [
          {
            name: `North America ${id}`,
            geo_zones: [
              { type: "country", country_code: "us" },
              { type: "country", country_code: "ca" },
            ],
          },
        ],
      })
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
      })
      const profile = await fulfillment.createShippingProfiles({ name: `Default ${id}`, type: "default" })

      const seller = (await makeSeller()) as { id: string }
      const { result: options } = await createShippingOptionsWorkflow(container()).run({
        input: [
          {
            name: `Farm delivery ${id}`,
            service_zone_id: set.service_zones[0].id,
            shipping_profile_id: profile.id,
            provider_id: "manual_manual",
            price_type: "flat",
            type: { label: "Delivery", description: "Farm delivery", code: `delivery-${id}` },
            prices: [{ currency_code: "usd", amount: 5 }],
            rules: [],
          },
        ],
      })
      const option = options[0] as { id: string; name: string }
      await link.create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.FULFILLMENT]: { shipping_option_id: option.id } })

      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([
          {
            title: `Tomatoes ${id}`,
            handle: `tomatoes-${id}`,
            status: "published",
            options: [{ title: "Size", values: ["Crate"] }],
            variants: [{ title: "Crate", manage_inventory: false, options: { Size: "Crate" } }],
          },
        ])
      await link.create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.PRODUCT]: { product_id: product.id } })
      await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id } })
      await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [Modules.FULFILLMENT]: { shipping_profile_id: profile.id } })
      const [priceSet] = await container()
        .resolve(Modules.PRICING)
        .createPriceSets([{ prices: [{ amount: 10, currency_code: "usd" }] }])
      await link.create({
        [Modules.PRODUCT]: { variant_id: product.variants[0].id },
        [Modules.PRICING]: { price_set_id: priceSet.id },
      })

      return {
        pak,
        channel: channel as { id: string },
        oneCountry,
        twoCountries,
        seller,
        option,
        product: product as { id: string; title: string },
        variantId: product.variants[0].id as string,
      }
    }
    type Storefront = Awaited<ReturnType<typeof makeStorefront>>

    const send = (request: Promise<any>) => request.catch((e: any) => e.response ?? { status: `no response: ${e?.message}` })
    /** The response of a call that must answer 200, named in the failure when it does not. */
    async function ok(label: string, request: Promise<any>) {
      const res = await send(request)
      expect({ call: label, status: res.status, message: res.data?.message }).toEqual({
        call: label,
        status: 200,
        message: undefined,
      })
      return res.data
    }

    const readDefault = (s: Storefront, cartId: string) => api.get(`/store/carts/${cartId}`, s.pak)
    const readAsStorefront = (s: Storefront, cartId: string) =>
      api.get(`/store/carts/${cartId}?fields=${encodeURIComponent(cartFields)}`, s.pak)

    /**
     * The storefront's path for a cart in `region`, shipped to `country`,
     * every call asserted on what it returns: getOrSetCart, addToCart,
     * updateLineItem, retrieveCart, setAddresses, listCartOptions,
     * setShippingMethod, removeShippingMethod, initiatePaymentSession,
     * placeOrder, retrieveOrder (`storefront/src/lib/data/cart.ts`, `orders.ts`).
     */
    async function buy(s: Storefront, region: { id: string }, country: string, presetAddress: boolean) {
      // getOrSetCart: sdk.store.cart.create({ region_id })
      const created = (await ok("POST /store/carts", api.post(`/store/carts`, { region_id: region.id }, s.pak))).cart
      expect(created).toEqual(expect.objectContaining({ region_id: region.id, currency_code: "usd", items: [], total: 0 }))
      // Medusa presets the address of a region with exactly one country.
      if (presetAddress) expect(created.shipping_address).toEqual(expect.objectContaining({ country_code: country }))
      else expect(created.shipping_address ?? null).toBeNull()
      const cartId = created.id as string

      for (const [label, read] of [
        ["GET /store/carts/:id (default fields), new cart", readDefault],
        ["GET /store/carts/:id (storefront fields), new cart", readAsStorefront],
      ] as const) {
        expect((await ok(label, read(s, cartId))).cart).toEqual(expect.objectContaining({ id: cartId, items: [], total: 0 }))
      }

      // addToCart: sdk.store.cart.createLineItem
      const added = (
        await ok(
          "POST /store/carts/:id/line-items",
          api.post(`/store/carts/${cartId}/line-items`, { variant_id: s.variantId, quantity: 1 }, s.pak)
        )
      ).cart
      expect(added.items).toEqual([
        expect.objectContaining({ variant_id: s.variantId, product_id: s.product.id, quantity: 1, unit_price: 10 }),
      ])
      expect(added).toEqual(expect.objectContaining({ item_total: 10, total: 10 }))
      const lineId = added.items[0].id as string

      // updateLineItem
      const two = (
        await ok(
          "POST /store/carts/:id/line-items/:line_id",
          api.post(`/store/carts/${cartId}/line-items/${lineId}`, { quantity: 2 }, s.pak)
        )
      ).cart
      expect(two.items).toEqual([expect.objectContaining({ id: lineId, quantity: 2, unit_price: 10 })])
      expect(two).toEqual(expect.objectContaining({ item_total: 20, total: 20 }))

      const withLine = (await ok("GET /store/carts/:id (default fields), cart with a line", readDefault(s, cartId))).cart
      expect(withLine.items).toEqual([expect.objectContaining({ id: lineId, variant_id: s.variantId, quantity: 2, unit_price: 10 })])
      expect(withLine).toEqual(expect.objectContaining({ item_total: 20, total: 20 }))

      // retrieveCart: what the cart page and the checkout render from.
      const shown = (await ok("GET /store/carts/:id (storefront fields), cart with a line", readAsStorefront(s, cartId))).cart
      expect(shown.items).toHaveLength(1)
      expect(shown.items[0]).toEqual(
        expect.objectContaining({
          id: lineId,
          quantity: 2,
          unit_price: 10,
          total: 20,
          variant: expect.objectContaining({
            id: s.variantId,
            title: "Crate",
            options: [expect.objectContaining({ value: "Crate", option: expect.objectContaining({ title: "Size" }) })],
          }),
          product: expect.objectContaining({ id: s.product.id, seller: expect.objectContaining({ id: s.seller.id }) }),
        })
      )
      expect(shown.region).toEqual(expect.objectContaining({ id: region.id }))
      expect(shown.promotions).toEqual([])
      expect(shown).toEqual(expect.objectContaining({ item_total: 20, total: 20 }))

      // setAddresses: sdk.store.cart.update with both addresses and the email.
      const address = { ...ADDRESS, country_code: country }
      const addressed = (
        await ok(
          "POST /store/carts/:id (addresses)",
          api.post(`/store/carts/${cartId}`, { shipping_address: address, billing_address: address, email: "buyer@example.com" }, s.pak)
        )
      ).cart
      expect(addressed.email).toBe("buyer@example.com")
      expect(addressed.shipping_address).toEqual(expect.objectContaining(address))
      expect(addressed.billing_address).toEqual(expect.objectContaining(address))

      for (const [label, read] of [
        ["GET /store/carts/:id (default fields), cart with an address", readDefault],
        ["GET /store/carts/:id (storefront fields), cart with an address", readAsStorefront],
      ] as const) {
        const cart = (await ok(label, read(s, cartId))).cart
        expect(cart.shipping_address).toEqual(expect.objectContaining(address))
        expect(cart.items).toEqual([expect.objectContaining({ id: lineId, quantity: 2 })])
      }

      // listCartOptions
      const offered = (await ok("GET /store/shipping-options", api.get(`/store/shipping-options?cart_id=${cartId}`, s.pak)))
        .shipping_options
      expect(offered).toEqual([expect.objectContaining({ id: s.option.id, amount: 5 })])

      // setShippingMethod: Mercur's route, which checks the option against the sellers in the cart.
      const shipped = (
        await ok(
          "POST /store/carts/:id/shipping-methods",
          api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: s.option.id }, s.pak)
        )
      ).cart
      expect(shipped.shipping_methods).toEqual([expect.objectContaining({ shipping_option_id: s.option.id, amount: 5 })])
      expect(shipped).toEqual(expect.objectContaining({ item_total: 20, shipping_total: 5, total: 25 }))

      // removeShippingMethod, then the buyer picks it again.
      const unshipped = (
        await ok(
          "DELETE /store/carts/:id/shipping-methods",
          api.delete(`/store/carts/${cartId}/shipping-methods`, {
            ...s.pak,
            data: { shipping_method_ids: [shipped.shipping_methods[0].id] },
          })
        )
      ).cart
      expect(unshipped.shipping_methods).toEqual([])
      expect(unshipped).toEqual(expect.objectContaining({ shipping_total: 0, total: 20 }))
      await ok(
        "POST /store/carts/:id/shipping-methods (again)",
        api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: s.option.id }, s.pak)
      )

      const ready = (await ok("GET /store/carts/:id (storefront fields), cart with a shipping method", readAsStorefront(s, cartId)))
        .cart
      expect(ready.shipping_methods).toEqual([
        expect.objectContaining({ shipping_option_id: s.option.id, amount: 5, name: s.option.name }),
      ])
      expect(ready).toEqual(expect.objectContaining({ item_total: 20, shipping_total: 5, total: 25 }))

      // initiatePaymentSession: the js-sdk creates the collection, then the session.
      const collection = (await ok("POST /store/payment-collections", api.post(`/store/payment-collections`, { cart_id: cartId }, s.pak)))
        .payment_collection
      expect(collection).toEqual(expect.objectContaining({ amount: 25, currency_code: "usd" }))
      const session = (
        await ok(
          "POST /store/payment-collections/:id/payment-sessions",
          api.post(`/store/payment-collections/${collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, s.pak)
        )
      ).payment_collection
      expect(session.payment_sessions).toEqual([
        expect.objectContaining({ provider_id: "pp_system_default", amount: 25, status: "pending" }),
      ])

      const paying = (await ok("GET /store/carts/:id (default fields), cart with a payment session", readDefault(s, cartId))).cart
      expect(paying.payment_collection).toEqual(
        expect.objectContaining({
          id: collection.id,
          amount: 25,
          payment_sessions: [expect.objectContaining({ provider_id: "pp_system_default" })],
        })
      )
      expect(paying.shipping_methods).toEqual([expect.objectContaining({ shipping_option_id: s.option.id, amount: 5 })])

      // placeOrder: Mercur's completion answers with the order set.
      const placed = (await ok("POST /store/carts/:id/complete", api.post(`/store/carts/${cartId}/complete`, {}, s.pak))).order_set
      expect(placed.orders).toHaveLength(1)
      expect(placed.orders[0]).toEqual(expect.objectContaining({ email: "buyer@example.com", item_total: 20, shipping_total: 5, total: 25 }))
      const orderId = placed.orders[0].id as string
      // Mercur captures from an order_set.placed subscriber; let it finish.
      await drainSubscribers()

      // retrieveOrder: the confirmation page.
      const order = (
        await ok(
          "GET /store/orders/:id (storefront fields)",
          api.get(`/store/orders/${orderId}?fields=${encodeURIComponent(orderFields)}`, s.pak)
        )
      ).order
      expect(order).toEqual(
        expect.objectContaining({ id: orderId, email: "buyer@example.com", currency_code: "usd", item_total: 20, shipping_total: 5, total: 25 })
      )
      expect(order.items).toEqual([
        expect.objectContaining({
          quantity: 2,
          unit_price: 10,
          total: 20,
          variant: expect.objectContaining({ id: s.variantId }),
          product: expect.objectContaining({ id: s.product.id }),
        }),
      ])
      expect(order.shipping_address).toEqual(expect.objectContaining(address))
      expect(order.shipping_methods).toEqual([
        expect.objectContaining({ shipping_option_id: s.option.id, amount: 5, name: s.option.name }),
      ])
      expect(order.seller).toEqual(expect.objectContaining({ id: s.seller.id }))
      expect(order.order_set).toEqual(expect.objectContaining({ id: placed.id, cart_id: cartId }))
      expect(order.payment_collections).toEqual([
        expect.objectContaining({
          id: collection.id,
          amount: 25,
          payments: [expect.objectContaining({ provider_id: "pp_system_default", amount: 25 })],
        }),
      ])

      const plain = (await ok("GET /store/orders/:id (default fields)", api.get(`/store/orders/${orderId}`, s.pak))).order
      expect(plain).toEqual(expect.objectContaining({ id: orderId, item_total: 20, shipping_total: 5, total: 25 }))
      expect(plain.items).toEqual([expect.objectContaining({ quantity: 2, unit_price: 10, total: 20 })])
      expect(plain.shipping_address).toEqual(expect.objectContaining(address))

      return { cartId, orderId, collectionId: collection.id as string }
    }

    describe("a buyer's cart, from the first add to the confirmation page", () => {
      afterEach(settleBeforeTeardown)

      run("in a region with exactly one country, where Medusa presets the shipping address", async () => {
        const s = await makeStorefront()
        await buy(s, s.oneCountry, "us", true)
      })

      run("in a region with two countries, where the buyer's address is the first one the cart has", async () => {
        const s = await makeStorefront()
        await buy(s, s.twoCountries, "ca", false)
      })
    })

    describe("each call SD-117 names, on carts that exist whatever the routes answer", () => {
      afterEach(settleBeforeTeardown)

      run("answers 200: the cart reads, the writes that end in one, Mercur's shipping-method routes and the admin's cancel", async () => {
        const s = await makeStorefront()
        const carts = container().resolve(Modules.CART)
        const statuses: Record<string, unknown> = {}
        const call = async (label: string, request: Promise<any>) => {
          const res = await send(request)
          statuses[label] = res.status
          return res.data
        }
        const reads = async (state: string, cartId: string) => {
          await call(`GET cart, default fields: ${state}`, readDefault(s, cartId))
          await call(`GET cart, storefront fields: ${state}`, readAsStorefront(s, cartId))
        }

        await call("POST /store/carts, one-country region", api.post(`/store/carts`, { region_id: s.oneCountry.id }, s.pak))

        // The carts under test are made through the cart module, so that each
        // call below is made whether or not the one before it answered.
        const [withAddress] = await carts.createCarts([
          {
            currency_code: "usd",
            region_id: s.oneCountry.id,
            sales_channel_id: s.channel.id,
            shipping_address: { country_code: "us" },
          },
        ])
        const [cart] = await carts.createCarts([
          { currency_code: "usd", region_id: s.twoCountries.id, sales_channel_id: s.channel.id },
        ])
        await reads("empty cart", cart.id)
        await reads("cart with an address", withAddress.id)

        await addToCartWorkflow(container()).run({ input: { cart_id: cart.id, items: [{ variant_id: s.variantId, quantity: 1 }] } })
        await reads("cart with a variant line", cart.id)

        await call("POST line-items", api.post(`/store/carts/${cart.id}/line-items`, { variant_id: s.variantId, quantity: 1 }, s.pak))
        const [line] = await carts.listLineItems({ cart_id: cart.id })
        await call("POST line-items/:line_id", api.post(`/store/carts/${cart.id}/line-items/${line.id}`, { quantity: 2 }, s.pak))

        const address = { ...ADDRESS, country_code: "ca" }
        await call(
          "POST /store/carts/:id, addresses",
          api.post(`/store/carts/${cart.id}`, { shipping_address: address, billing_address: address, email: "buyer@example.com" }, s.pak)
        )
        await reads("cart with a line and an address", cart.id)

        await call("POST shipping-methods (Mercur)", api.post(`/store/carts/${cart.id}/shipping-methods`, { option_id: s.option.id }, s.pak))
        const [method] = await carts.listShippingMethods({ cart_id: cart.id })
        await call(
          "DELETE shipping-methods (Mercur)",
          api.delete(`/store/carts/${cart.id}/shipping-methods`, { ...s.pak, data: { shipping_method_ids: [method?.id] } })
        )
        await call("POST shipping-methods again", api.post(`/store/carts/${cart.id}/shipping-methods`, { option_id: s.option.id }, s.pak))
        await reads("cart with a shipping method", cart.id)

        const collection = await call("POST /store/payment-collections", api.post(`/store/payment-collections`, { cart_id: cart.id }, s.pak))
        await call(
          "POST payment-sessions",
          api.post(
            `/store/payment-collections/${collection?.payment_collection?.id}/payment-sessions`,
            { provider_id: "pp_system_default" },
            s.pak
          )
        )
        const done = await call("POST complete", api.post(`/store/carts/${cart.id}/complete`, {}, s.pak))
        await drainSubscribers()
        const orderId = done?.order_set?.orders?.[0]?.id as string

        // An admin cancels the paid storefront order: Medusa refunds what was captured.
        const [user] = await container().resolve(Modules.USER).createUsers([{ email: `admin+${uid()}@example.com` }])
        const secret = process.env.JWT_SECRET
        if (!secret) throw new Error("JWT_SECRET is not set in the test env")
        const token = jwt.sign(
          { actor_id: user.id, actor_type: "user", auth_identity_id: "", app_metadata: { user_id: user.id } },
          secret,
          { expiresIn: "1h" }
        )
        const cancelled = await call(
          "POST /admin/orders/:id/cancel",
          api.post(`/admin/orders/${orderId}/cancel`, {}, { headers: { authorization: `Bearer ${token}` } })
        )

        expect(statuses).toEqual(Object.fromEntries(Object.keys(statuses).map((label) => [label, 200])))
        expect(Object.keys(statuses)).toHaveLength(21)

        // And the cancel did what Medusa's cancel does to a captured payment.
        expect(cancelled.order).toEqual(expect.objectContaining({ id: orderId, status: "canceled" }))
        const payments = container().resolve(Modules.PAYMENT)
        const [payment] = await payments.listPayments(
          { payment_collection_id: collection.payment_collection.id },
          { relations: ["captures", "refunds"] }
        )
        const sum = (rows: Array<{ amount: unknown }> = []) => rows.reduce((total, row) => total + Number(row.amount), 0)
        expect({ captured: sum(payment.captures), refunded: sum(payment.refunds) }).toEqual({ captured: 25, refunded: 25 })
      })
    })
  },
})
