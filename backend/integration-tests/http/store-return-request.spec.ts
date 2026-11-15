import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { beginReturnOrderWorkflow, createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createPublishableKeyToken } from "./_publishable-key"
import jwt from "jsonwebtoken"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * The storefront's returns flow, `POST`/`GET /store/return-request`, on a
 * real migrated database: the real order, fulfillment, stock-location,
 * pricing, seller and link modules, Medusa's own
 * `createAndCompleteReturnOrderWorkflow`, and Mercur's `/vendor/returns`
 * routes on the seller's side. Nothing about the order or the return is
 * mocked.
 *
 * Before this route existed both calls answered 404: the path was served by
 * `@mercurjs/requests`, which `medusa-config.ts` no longer loads, and nothing
 * else registers a handler for it. The last test is the one that matters to
 * the seller: a request the buyer files must show up in `/vendor/returns`,
 * which reads through Mercur's seller–return link and nothing else.
 */
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

    /**
     * A registered customer of the store, signed in through the real
     * register / create / login routes.
     */
    async function signedInCustomer() {
      const pak = await createPublishableKeyToken(getContainer)
      const email = `buyer-${uid()}@example.com`
      const password = `${uid()}-${uid()}`
      const registered = await api.post("/auth/customer/emailpass/register", { email, password })
      const created = await api.post(
        "/store/customers",
        { email },
        { headers: { authorization: `Bearer ${registered.data.token}`, "x-publishable-api-key": pak } }
      )
      const login = await api.post("/auth/customer/emailpass", { email, password })
      return {
        customer: created.data.customer as { id: string; email: string },
        pak,
        asCustomer: { headers: { authorization: `Bearer ${login.data.token}`, "x-publishable-api-key": pak } },
      }
    }

    /**
     * Another customer, with a bearer token signed by the server's own
     * JWT_SECRET (as helpers/seller-auth.ts falls back to). The auth routes
     * share one 20-a-minute limiter per IP, and every buyer through them costs
     * three of it; the route under test reads only the verified actor.
     */
    async function tokenCustomer() {
      const pak = await createPublishableKeyToken(getContainer)
      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers([{ email: `buyer-${uid()}@example.com` }])
      const token = jwt.sign(
        { actor_id: customer.id, actor_type: "customer", auth_identity_id: `authid_${uid()}`, app_metadata: {} },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      )
      return {
        customer: customer as { id: string; email: string },
        pak,
        asCustomer: { headers: { authorization: `Bearer ${token}`, "x-publishable-api-key": pak } },
      }
    }

    async function plainSeller() {
      const id = uid()
      const created = await container()
        .resolve(SELLER_MODULE)
        .createSellers({ name: `Grower ${id}`, handle: `grower-${id}` })
      return (Array.isArray(created) ? created[0] : created) as { id: string }
    }

    /**
     * A return shipping option the seller offers: a priced option on a service
     * zone whose fulfillment set sits at the seller's stock location, marked
     * `is_return`, and linked to the seller the way Mercur's
     * `/store/shipping-options/return` reads it.
     */
    async function returnShippingOption(sellerId: string) {
      const id = uid()
      const fulfillment = container().resolve(Modules.FULFILLMENT)
      const link = container().resolve(ContainerRegistrationKeys.LINK)
      const [location] = await container()
        .resolve(Modules.STOCK_LOCATION)
        .createStockLocations([{ name: `Farm ${id}` }])
      const set = await fulfillment.createFulfillmentSets({
        name: `Returns ${id}`,
        type: "shipping",
        service_zones: [{ name: `US ${id}`, geo_zones: [{ type: "country", country_code: "us" }] }],
      })
      await link.create([
        {
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
        },
        {
          [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
          [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
        },
      ])
      const profile = await fulfillment.createShippingProfiles({ name: `Returns ${id}`, type: "default" })
      const { result } = await createShippingOptionsWorkflow(container()).run({
        input: [
          {
            name: `Drop-off ${id}`,
            service_zone_id: set.service_zones[0].id,
            shipping_profile_id: profile.id,
            provider_id: "manual_manual",
            price_type: "flat",
            type: { label: "Drop-off", description: "Return drop-off", code: `return-${id}` },
            prices: [{ currency_code: "usd", amount: 0 }],
            rules: [{ attribute: "is_return", operator: "eq", value: "true" }],
          },
        ] as any,
      })
      const option = result[0] as { id: string }
      await link.create({
        [SELLER_MODULE]: { seller_id: sellerId },
        [Modules.FULFILLMENT]: { shipping_option_id: option.id },
      })
      return option
    }

    /** One of the seller's orders, placed by the customer and fulfilled. */
    async function fulfilledOrder(customer: { id: string; email: string }, sellerId: string) {
      const orders = container().resolve(Modules.ORDER)
      const [order] = await orders.createOrders([
        {
          currency_code: "usd",
          customer_id: customer.id,
          email: customer.email,
          items: [{ title: "Tomatoes", quantity: 2, unit_price: 5 }],
        },
      ])
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [SELLER_MODULE]: { seller_id: sellerId },
        [Modules.ORDER]: { order_id: order.id },
      })
      const [withItems] = await orders.listOrders({ id: order.id }, { relations: ["items"] })
      const item = withItems.items[0]
      await orders.registerFulfillment({ order_id: order.id, items: [{ id: item.id, quantity: 2 }] })
      return { order: order as { id: string }, itemId: item.id as string }
    }

    async function returnReason() {
      const [reason] = await container()
        .resolve(Modules.ORDER)
        .createReturnReasons([{ value: `damaged-${uid()}`, label: "Arrived damaged" }])
      return reason as { id: string }
    }

    const returnsFor = (orderId: string) =>
      container().resolve(Modules.ORDER).listReturns({ order_id: orderId }) as Promise<
        { id: string; status: string }[]
      >

    /** The order item's quantity counters (the order module's `order_item` row). */
    async function itemCounters(orderId: string, itemId: string) {
      const [order] = await container()
        .resolve(Modules.ORDER)
        .listOrders({ id: orderId }, { relations: ["items"] })
      const item = order.items.find((i: { id: string }) => i.id === itemId)
      const detail = item.detail ?? item
      return {
        return_requested: Number(detail.return_requested_quantity ?? 0),
        return_received: Number(detail.return_received_quantity ?? 0),
      }
    }

    const requestBody = (orderId: string, optionId: string, itemId: string, quantity: number, reasonId: string) => ({
      order_id: orderId,
      customer_note: "",
      shipping_option_id: optionId,
      line_items: [{ line_item_id: itemId, quantity, reason_id: reasonId }],
    })

    describe("POST/GET /store/return-request", () => {
      it("files a buyer's return against their own order, lists it back, and shows it to the seller", async () => {
        const vendor = await createAuthenticatedSeller({ api, getContainer })
        const { customer, asCustomer } = await signedInCustomer()
        const option = await returnShippingOption(vendor.seller.id)
        const { order, itemId } = await fulfilledOrder(customer, vendor.seller.id)
        const reason = await returnReason()

        // Exactly what OrderReturnSection.handleSubmit sends.
        const created = await safe(
          api.post(
            "/store/return-request",
            {
              order_id: order.id,
              customer_note: "",
              shipping_option_id: option.id,
              line_items: [{ line_item_id: itemId, quantity: 1, reason_id: reason.id }],
            },
            asCustomer
          )
        )
        expect(created.status).toBe(201)
        const request = created.data.order_return_request
        expect(request.id).toEqual(expect.any(String))
        expect(request.status).toBe("requested")
        expect(request.order.id).toBe(order.id)
        expect(request.line_items).toEqual([
          expect.objectContaining({ line_item_id: itemId, quantity: 1, reason_id: reason.id }),
        ])

        // A real Medusa return, on the order, not a row in a side table.
        expect((await returnsFor(order.id)).map((r) => r.id)).toEqual([request.id])

        // The list the /user/returns page renders.
        const listed = await safe(api.get("/store/return-request", asCustomer))
        expect(listed.status).toBe(200)
        expect(listed.data.order_return_requests).toHaveLength(1)
        const row = listed.data.order_return_requests[0]
        expect(row.id).toBe(request.id)
        expect(row.status).toBe("requested")
        expect(row.order).toEqual(
          expect.objectContaining({ id: order.id, display_id: expect.anything(), currency_code: "usd" })
        )
        expect(row.order.seller).toEqual(expect.objectContaining({ id: vendor.seller.id }))
        expect(row.order.items.map((i: { id: string }) => i.id)).toContain(itemId)
        expect(row.line_items[0]).toEqual(
          expect.objectContaining({ line_item_id: itemId, reason_id: reason.id, created_at: expect.anything() })
        )

        // The seller sees it, through the same link /vendor/returns reads.
        const vendorList = await safe(api.get("/vendor/returns", authHeader(vendor.token)))
        expect(vendorList.status).toBe(200)
        const vendorIds = (vendorList.data.returns as { id?: string; return?: { id: string } }[]).map(
          (r) => r.return?.id ?? r.id
        )
        expect(vendorIds).toContain(request.id)
        const vendorDetail = await safe(api.get(`/vendor/returns/${request.id}`, authHeader(vendor.token)))
        expect(vendorDetail.status).toBe(200)

        // The shapes the vendor panel actually receives, read with the panel's
        // own `fields` (vendor-panel/src/hooks/api/requests.tsx). Mercur's list
        // answers link rows, the return nested under `return`; its detail
        // answers `return` as an array. The panel's normalisers unwrap both,
        // and their spec pins these shapes.
        const panelList = await safe(
          api.get("/vendor/returns", {
            ...authHeader(vendor.token),
            params: { fields: "id,status,created_at,*order,*order.customer,*items", limit: 10, offset: 0 },
          })
        )
        expect(panelList.status).toBe(200)
        const panelRow = (panelList.data.returns as { id?: string; return?: Record<string, any> }[]).find(
          (r) => r.return?.id === request.id
        )
        expect(panelRow?.id).toBeUndefined()
        expect(panelRow?.return).toEqual(
          expect.objectContaining({
            id: request.id,
            status: "requested",
            order: expect.objectContaining({ id: order.id, customer: expect.objectContaining({ id: customer.id }) }),
            items: [expect.objectContaining({ item_id: itemId, quantity: 1 })],
          })
        )
        const panelDetail = await safe(
          api.get(`/vendor/returns/${request.id}`, {
            ...authHeader(vendor.token),
            params: { fields: "*order,*order.customer,*items" },
          })
        )
        expect(panelDetail.status).toBe(200)
        expect(Array.isArray(panelDetail.data.return)).toBe(true)
        expect(panelDetail.data.return[0]).toEqual(
          expect.objectContaining({ id: request.id, order: expect.objectContaining({ id: order.id }) })
        )
      })

      it("refuses another customer's order with 403, and lists none of its returns", async () => {
        const seller = await plainSeller()
        const owner = await tokenCustomer()
        const stranger = await tokenCustomer()
        const option = await returnShippingOption(seller.id)
        const { order, itemId } = await fulfilledOrder(owner.customer, seller.id)
        const reason = await returnReason()
        const body = {
          order_id: order.id,
          customer_note: "",
          shipping_option_id: option.id,
          line_items: [{ line_item_id: itemId, quantity: 1, reason_id: reason.id }],
        }

        const refused = await safe(api.post("/store/return-request", body, stranger.asCustomer))
        expect(refused.status).toBe(403)
        // The same answer for an order id that does not exist: no existence oracle.
        const unknown = await safe(
          api.post("/store/return-request", { ...body, order_id: "order_does_not_exist" }, stranger.asCustomer)
        )
        expect(unknown.status).toBe(403)
        expect(await returnsFor(order.id)).toEqual([])

        const filed = await safe(api.post("/store/return-request", body, owner.asCustomer))
        expect(filed.status).toBe(201)
        expect(await returnsFor(order.id)).toHaveLength(1)
        const strangerList = await safe(api.get("/store/return-request", stranger.asCustomer))
        expect(strangerList.status).toBe(200)
        expect(strangerList.data.order_return_requests).toEqual([])
      })

      it("refuses a return shipping option the order's seller does not offer", async () => {
        const seller = await plainSeller()
        const otherSeller = await plainSeller()
        const { customer, asCustomer } = await tokenCustomer()
        await returnShippingOption(seller.id)
        const foreign = await returnShippingOption(otherSeller.id)
        const { order, itemId } = await fulfilledOrder(customer, seller.id)
        const reason = await returnReason()

        const refused = await safe(
          api.post(
            "/store/return-request",
            {
              order_id: order.id,
              customer_note: "",
              shipping_option_id: foreign.id,
              line_items: [{ line_item_id: itemId, quantity: 1, reason_id: reason.id }],
            },
            asCustomer
          )
        )
        expect(refused.status).toBe(400)
        expect(await returnsFor(order.id)).toEqual([])
      })

      it("lists only the buyer's requests: an operator's open return with no items is left out", async () => {
        const seller = await plainSeller()
        const { customer, asCustomer } = await tokenCustomer()
        const option = await returnShippingOption(seller.id)
        const { order, itemId } = await fulfilledOrder(customer, seller.id)
        const reason = await returnReason()

        const filed = await safe(
          api.post("/store/return-request", requestBody(order.id, option.id, itemId, 1, reason.id), asCustomer)
        )
        expect(filed.status).toBe(201)

        // What an operator leaves behind by starting a return and not
        // confirming it: status `open`, no items yet.
        await beginReturnOrderWorkflow(container()).run({ input: { order_id: order.id } })
        const all = await returnsFor(order.id)
        expect(all.map((r) => r.status).sort()).toEqual(["open", "requested"])

        const listed = await safe(api.get("/store/return-request", asCustomer))
        expect(listed.status).toBe(200)
        expect(listed.data.order_return_requests.map((r: { id: string }) => r.id)).toEqual([
          filed.data.order_return_request.id,
        ])
        for (const row of listed.data.order_return_requests) {
          expect(row.line_items.length).toBeGreaterThan(0)
        }
      })

      it("files one return when two requests for the same units arrive at once", async () => {
        const seller = await plainSeller()
        const { customer, asCustomer } = await tokenCustomer()
        const option = await returnShippingOption(seller.id)
        const { order, itemId } = await fulfilledOrder(customer, seller.id)
        const reason = await returnReason()
        const body = requestBody(order.id, option.id, itemId, 2, reason.id)

        const answers = await Promise.all([
          safe(api.post("/store/return-request", body, asCustomer)),
          safe(api.post("/store/return-request", body, asCustomer)),
        ])
        expect(answers.map((a) => a.status).sort()).toEqual([201, 400])
        expect(await returnsFor(order.id)).toHaveLength(1)
        // The order's counter agrees with the one return it carries.
        expect(await itemCounters(order.id, itemId)).toEqual({ return_requested: 2, return_received: 0 })
      })

      it("refuses to return units the seller has already received back", async () => {
        const vendor = await createAuthenticatedSeller({ api, getContainer })
        const { customer, asCustomer } = await tokenCustomer()
        const option = await returnShippingOption(vendor.seller.id)
        const { order, itemId } = await fulfilledOrder(customer, vendor.seller.id)
        const reason = await returnReason()

        const first = await safe(
          api.post("/store/return-request", requestBody(order.id, option.id, itemId, 2, reason.id), asCustomer)
        )
        expect(first.status).toBe(201)
        const returnId = first.data.order_return_request.id

        // The seller receives both units through Mercur's vendor routes:
        // begin the receipt, receive the items, confirm.
        const asVendor = authHeader(vendor.token)
        expect((await safe(api.post(`/vendor/returns/${returnId}/receive`, {}, asVendor))).status).toBe(200)
        expect(
          (
            await safe(
              api.post(`/vendor/returns/${returnId}/receive-items`, { items: [{ id: itemId, quantity: 2 }] }, asVendor)
            )
          ).status
        ).toBe(200)
        expect((await safe(api.post(`/vendor/returns/${returnId}/receive/confirm`, {}, asVendor))).status).toBe(200)
        // Core moved the units from requested to received, which by its own
        // count (fulfilled - requested) makes them returnable again.
        expect(await itemCounters(order.id, itemId)).toEqual({ return_requested: 0, return_received: 2 })

        const listed = await safe(api.get("/store/return-request", asCustomer))
        expect(listed.data.order_return_requests.map((r: { status: string }) => r.status)).toEqual(["received"])

        const again = await safe(
          api.post("/store/return-request", requestBody(order.id, option.id, itemId, 2, reason.id), asCustomer)
        )
        expect(again.status).toBe(400)
        const oneMore = await safe(
          api.post("/store/return-request", requestBody(order.id, option.id, itemId, 1, reason.id), asCustomer)
        )
        expect(oneMore.status).toBe(400)
        expect(await returnsFor(order.id)).toHaveLength(1)
      })

      it("refuses core's POST /store/returns, which takes no customer and links no seller", async () => {
        const seller = await plainSeller()
        const { customer, pak, asCustomer } = await tokenCustomer()
        const option = await returnShippingOption(seller.id)
        const { order, itemId } = await fulfilledOrder(customer, seller.id)
        const reason = await returnReason()

        // A valid core body, holding nothing but the publishable key.
        const anonymous = await safe(
          api.post(
            "/store/returns",
            { order_id: order.id, items: [{ id: itemId, quantity: 2 }], return_shipping: { option_id: option.id } },
            { headers: { "x-publishable-api-key": pak } }
          )
        )
        expect(anonymous.status).toBe(410)
        // Signed in makes no difference: core's route still checks no ownership.
        const signedIn = await safe(
          api.post(
            "/store/returns",
            { order_id: order.id, items: [{ id: itemId, quantity: 2 }], return_shipping: { option_id: option.id } },
            asCustomer
          )
        )
        expect(signedIn.status).toBe(410)
        expect(await returnsFor(order.id)).toEqual([])

        // The returnable quantity is intact for the buyer's own request.
        const filed = await safe(
          api.post("/store/return-request", requestBody(order.id, option.id, itemId, 2, reason.id), asCustomer)
        )
        expect(filed.status).toBe(201)
      })

      it("requires a signed-in customer", async () => {
        const { pak } = await tokenCustomer()
        const headers = { headers: { "x-publishable-api-key": pak } }
        expect((await safe(api.get("/store/return-request", headers))).status).toBe(401)
        expect(
          (
            await safe(
              api.post(
                "/store/return-request",
                { order_id: "order_x", customer_note: "", shipping_option_id: "so_x", line_items: [] },
                headers
              )
            )
          ).status
        ).toBe(401)
      })
    })
  },
})
