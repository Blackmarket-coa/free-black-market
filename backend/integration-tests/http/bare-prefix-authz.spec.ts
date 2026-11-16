import { createHmac } from "crypto"
import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { RESTAURANT_MODULE } from "../../src/modules/restaurant"
import { DELIVERY_MODULE } from "../../src/modules/delivery"
import { TICKET_BOOKING_MODULE } from "../../src/modules/ticket-booking"
import { VENDOR_BILLING_MODULE } from "../../src/modules/vendor-billing"
import { CREATOR_PROGRAM_MODULE } from "../../src/modules/creator-program"
import { CONTENT_PLATFORM_MODULE } from "../../src/modules/content-platform"
import { createPublishableKeyToken } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * Routes outside /store, /admin, /vendor and /auth, on the real server and a
 * real migrated database, with no credentials (SD-116 and its sweep).
 *
 * Medusa gives those four trees a default and nothing else. Run here before
 * any change, sending no `Authorization` header and no publishable key:
 *
 *   POST   /restaurants                         200, restaurant created
 *   POST   /restaurants/:id/products            200, product created
 *   DELETE /restaurants/:id/products            200 for a product that was not
 *                                               the restaurant's; it was gone
 *   GET    /restaurants/:id                     200, each delivery with its
 *                                               cart's email and customer_id
 *   GET    /restaurants?admins[email]=…         200: a filter on any relation
 *   POST   /tickets/:id/verify                  200, the ticket was "scanned"
 *   POST   /store/tickets/:id/verify            the same, with the publishable
 *                                               key alone
 *   DELETE /restaurants/<any id>/admins/:id     200, another restaurant's admin
 *                                               was gone
 *   POST   /v1/admin/... (admin cookie, sent    reached the handler; /admin/**
 *           from another site's origin)         answers that 403
 *   POST   /webhooks/vendor-billing/stripe      200 "paid" for an event signed
 *                                               with an EMPTY key, while
 *                                               STRIPE_WEBHOOK_SECRET is unset
 *   GET    /v1/marketplace/programs/:id         200, an invite-only program's
 *                                               whole row: brief, budget cap
 *   POST   /v1/webhooks/content-platform/custom 200 for a signature of the
 *                                               empty string; 401 for one over
 *                                               the body actually sent
 *
 * Every case below asserts what the caller is told AND what the tables hold
 * afterwards. `src/api/__tests__/bare-prefix-route-guards.unit.spec.ts` walks
 * every route out here; this proves the doors on the assembled app.
 */

const ADMIN_ORIGIN = "https://admin.bare-prefix-spec.test"
const STRIPE_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const

medusaIntegrationTestRunner({
  inApp: true,
  env: { ADMIN_CORS: ADMIN_ORIGIN },
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

    const savedEnv: Record<string, string | undefined> = {}
    beforeAll(() => {
      for (const key of STRIPE_KEYS) savedEnv[key] = process.env[key]
    })
    afterEach(() => {
      for (const key of STRIPE_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key]
        else process.env[key] = savedEnv[key]
      }
    })

    const sign = (claims: Record<string, unknown>) => {
      const secret = process.env.JWT_SECRET
      if (!secret) throw new Error("JWT_SECRET is not set in the test env")
      return jwt.sign(claims, secret, { expiresIn: "1h" })
    }
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

    /** A real admin user and a bearer token Medusa's admin auth accepts. */
    async function asAdmin() {
      const [user] = await container().resolve(Modules.USER).createUsers([{ email: `admin+${uid()}@example.com` }])
      const token = sign({ actor_id: user.id, actor_type: "user", auth_identity_id: "", app_metadata: { user_id: user.id } })
      return { user, token, headers: bearer(token) }
    }
    /** Tokens that are real for their own surface and nobody's out here. */
    const strangers = () => ({
      customer: bearer(sign({ actor_id: "cus_stranger", actor_type: "customer", auth_identity_id: "authid_c", app_metadata: {} })),
      seller: bearer(sign({ actor_id: "sel_stranger", actor_type: "seller", auth_identity_id: "authid_s", app_metadata: {} })),
      // What `/auth/restaurant/emailpass/register` hands out: the actor type, and no actor.
      unregisteredRestaurant: bearer(sign({ actor_id: "", actor_type: "restaurant", auth_identity_id: "authid_r", app_metadata: {} })),
    })

    const restaurants = () => container().resolve(RESTAURANT_MODULE)
    const products = () => container().resolve(Modules.PRODUCT)
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)

    /** A restaurant with one menu product linked to it. */
    async function seedRestaurant(label: string) {
      const restaurant = await restaurants().createRestaurants({
        name: `${label} Diner`,
        handle: `${label}-${uid()}`,
        address: "1 Main St",
        phone: "555-0100",
        email: `${label}@example.com`,
      })
      const [product] = await products().createProducts([{ title: `${label} burger`, handle: `burger-${uid()}`, status: "published" }])
      await link().create({ [RESTAURANT_MODULE]: { restaurant_id: restaurant.id }, [Modules.PRODUCT]: { product_id: product.id } })
      return { restaurant, product }
    }
    const liveProductIds = async (ids: string[]) =>
      ((await products().listProducts({ id: ids })) as { id: string }[]).map((p) => p.id).sort()

    const REFUSAL = { message: "You do not have access to this record.", type: "not_allowed" }
    const NEW_RESTAURANT = { name: "Anon Diner", handle: "anon-diner", address: "1 Main St", phone: "555", email: "owner@example.com" }
    const NEW_PRODUCT = {
      products: [
        {
          title: "Fries",
          handle: "fries",
          options: [{ title: "Size", values: ["S"] }],
          variants: [{ title: "S", options: { Size: "S" }, prices: [{ amount: 5, currency_code: "eur" }] }],
        },
      ],
    }

    describe("/restaurants answers an admin user and nobody else", () => {
      it("with no credentials every verb is 401, and nothing is created, deleted or read", async () => {
        const a = await seedRestaurant("a")
        const [loose] = await products().createProducts([{ title: "A seller's product", handle: `loose-${uid()}`, status: "published" }])
        const admin = await restaurants().createRestaurantAdmins({ first_name: "Ada", last_name: "Admin", email: "ada@example.com", restaurant_id: a.restaurant.id })
        // A delivery of this restaurant, with the diner's cart: what the detail read served.
        const delivery = await container().resolve(DELIVERY_MODULE).createDeliveries({ transaction_id: "tx_1" })
        const cart = await container().resolve(Modules.CART).createCarts({ currency_code: "eur", email: "diner@example.com", customer_id: "cus_private_1" })
        await link().create({ [RESTAURANT_MODULE]: { restaurant_id: a.restaurant.id }, [DELIVERY_MODULE]: { delivery_id: delivery.id } })
        await link().create({ [DELIVERY_MODULE]: { delivery_id: delivery.id }, [Modules.CART]: { cart_id: cart.id } })

        const rid = a.restaurant.id
        const doors: [string, () => Promise<any>][] = [
          ["POST /restaurants", () => api.post("/restaurants", NEW_RESTAURANT)],
          ["POST /restaurants/:id/products", () => api.post(`/restaurants/${rid}/products`, NEW_PRODUCT)],
          ["DELETE /restaurants/:id/products (not its product)", () => api.delete(`/restaurants/${rid}/products`, { data: { product_ids: [loose.id] } })],
          ["DELETE /restaurants/:id/products (its own)", () => api.delete(`/restaurants/${rid}/products`, { data: { product_ids: [a.product.id] } })],
          ["DELETE /restaurants/:id/admins/:admin_id", () => api.delete(`/restaurants/${rid}/admins/${admin.id}`)],
          ["GET /restaurants", () => api.get("/restaurants")],
          ["GET /restaurants/:id", () => api.get(`/restaurants/${rid}`)],
          ["GET /restaurants?admins[email]", () => api.get("/restaurants?admins[email]=ada@example.com")],
          // Express routes these spellings to the same handlers.
          ["GET /RESTAURANTS", () => api.get("/RESTAURANTS")],
          ["GET /restaurants/", () => api.get("/restaurants/")],
          ["GET /Restaurants/:id/", () => api.get(`/Restaurants/${rid}/`)],
          ["DELETE /restaurants/:id/products/", () => api.delete(`/restaurants/${rid}/products/`, { data: { product_ids: [loose.id] } })],
          ["DELETE /RESTAURANTS/:id/PRODUCTS", () => api.delete(`/RESTAURANTS/${rid}/PRODUCTS`, { data: { product_ids: [loose.id] } })],
          ["DELETE /restaurants/<percent-encoded id>/products", () => api.delete(`/restaurants/${encodeURIComponent(rid).replace(/^./, (ch) => `%${ch.charCodeAt(0).toString(16)}`)}/products`, { data: { product_ids: [loose.id] } })],
        ]
        for (const [label, door] of doors) {
          const res = await call(door())
          expect([label, res.status]).toEqual([label, 401])
          expect(res.data).toEqual({ message: "Unauthorized" })
        }
        // A customer, a seller and a just-registered "restaurant" identity are nobody here too.
        for (const [who, headers] of Object.entries(strangers())) {
          for (const res of [
            await call(api.post("/restaurants", NEW_RESTAURANT, headers)),
            await call(api.delete(`/restaurants/${rid}/products`, { ...headers, data: { product_ids: [loose.id] } })),
            await call(api.get(`/restaurants/${rid}`, headers)),
          ]) {
            expect([who, res.status]).toEqual([who, 401])
          }
        }

        expect((await restaurants().listRestaurants({})).map((r: { id: string }) => r.id)).toEqual([rid])
        expect(await liveProductIds([loose.id, a.product.id])).toEqual([loose.id, a.product.id].sort())
        expect(await products().listProducts({ handle: "fries" })).toEqual([])
        expect(await restaurants().listRestaurantAdmins({ id: [admin.id] })).toHaveLength(1)
      })

      it("an admin creates a restaurant and its products; the delete takes only that restaurant's products", async () => {
        const admin = await asAdmin()
        const a = await seedRestaurant("a")
        const b = await seedRestaurant("b")
        const [loose] = await products().createProducts([{ title: "A seller's product", handle: `loose-${uid()}`, status: "published" }])

        const created = await call(api.post("/restaurants", NEW_RESTAURANT, admin.headers))
        expect(created.status).toBe(200)
        const added = await call(api.post(`/restaurants/${created.data.restaurant.id}/products`, NEW_PRODUCT, admin.headers))
        expect(added.status).toBe(200)
        const fries = added.data.restaurant_products[0].id as string

        // Not this restaurant's: a seller's product, another restaurant's, one that does not exist.
        for (const ids of [[loose.id], [b.product.id], ["prod_does_not_exist"], [a.product.id, loose.id]]) {
          const res = await call(api.delete(`/restaurants/${a.restaurant.id}/products`, { ...admin.headers, data: { product_ids: ids } }))
          expect([ids, res.status]).toEqual([ids, 403])
          expect(res.data).toEqual(REFUSAL)
        }
        // A restaurant that does not exist is the same refusal.
        const missing = await call(api.delete(`/restaurants/rst_does_not_exist/products`, { ...admin.headers, data: { product_ids: [a.product.id] } }))
        expect([missing.status, missing.data]).toEqual([403, REFUSAL])
        // Nothing was deleted by any of them, the mixed request's own product included.
        expect(await liveProductIds([loose.id, a.product.id, b.product.id, fries])).toEqual([loose.id, a.product.id, b.product.id, fries].sort())

        const own = await call(api.delete(`/restaurants/${a.restaurant.id}/products`, { ...admin.headers, data: { product_ids: [a.product.id] } }))
        expect([own.status, own.data]).toEqual([200, { success: true }])
        expect(await liveProductIds([loose.id, a.product.id, b.product.id, fries])).toEqual([loose.id, b.product.id, fries].sort())
      })

      it("an admin removes a restaurant's own admin only, and the list takes an allow-list of filters", async () => {
        const admin = await asAdmin()
        const a = await seedRestaurant("a")
        const b = await seedRestaurant("b")
        const adminOfA = await restaurants().createRestaurantAdmins({ first_name: "Ada", last_name: "A", email: "ada@example.com", restaurant_id: a.restaurant.id })
        const adminOfB = await restaurants().createRestaurantAdmins({ first_name: "Bo", last_name: "B", email: "bo@example.com", restaurant_id: b.restaurant.id })
        // The workflow clears the admin's auth identity, so each has one.
        const auth = container().resolve(Modules.AUTH)
        for (const row of [adminOfA, adminOfB]) {
          await auth.createAuthIdentities({
            provider_identities: [{ provider: "emailpass", entity_id: row.email }],
            app_metadata: { restaurant_id: row.id },
          })
        }

        const foreign = await call(api.delete(`/restaurants/${a.restaurant.id}/admins/${adminOfB.id}`, admin.headers))
        expect([foreign.status, foreign.data]).toEqual([403, REFUSAL])
        const unknown = await call(api.delete(`/restaurants/${a.restaurant.id}/admins/radm_does_not_exist`, admin.headers))
        expect([unknown.status, unknown.data]).toEqual([403, REFUSAL])
        expect(await restaurants().listRestaurantAdmins({ id: [adminOfA.id, adminOfB.id] })).toHaveLength(2)

        const own = await call(api.delete(`/restaurants/${a.restaurant.id}/admins/${adminOfA.id}`, admin.headers))
        expect([own.status, own.data]).toEqual([200, { message: "success" }])
        expect((await restaurants().listRestaurantAdmins({ id: [adminOfA.id, adminOfB.id] })).map((r: { id: string }) => r.id)).toEqual([adminOfB.id])

        // The list: allow-listed filters filter, anything else is refused.
        const all = await call(api.get("/restaurants", admin.headers))
        expect(all.status).toBe(200)
        expect(all.data.restaurants.map((r: { id: string }) => r.id).sort()).toEqual([a.restaurant.id, b.restaurant.id].sort())
        const byHandle = await call(api.get(`/restaurants?handle=${a.restaurant.handle}`, admin.headers))
        expect(byHandle.data.restaurants.map((r: { id: string }) => r.id)).toEqual([a.restaurant.id])
        const closed = await call(api.get("/restaurants?is_open=true", admin.headers))
        expect([closed.status, closed.data.restaurants]).toEqual([200, []])
        for (const query of ["admins[email]=bo@example.com", "email=b@example.com", "handle[$like]=%25", "deliveries[cart][email]=diner@example.com"]) {
          const res = await call(api.get(`/restaurants?${query}`, admin.headers))
          expect([query, res.status, res.data.type]).toEqual([query, 400, "invalid_data"])
          expect(res.data.restaurants).toBeUndefined()
        }
      })

      it("a signed-in admin's cookie is refused from another site's origin and accepted from the panel's", async () => {
        const admin = await asAdmin()
        const a = await seedRestaurant("a")
        // A real session: Medusa's own /auth/session, as the admin panel signs in.
        const session = await api.post("/auth/session", {}, admin.headers)
        const cookie = (session.headers["set-cookie"] as string[]).map((c) => c.split(";")[0]).join("; ")
        expect(cookie).toMatch(/connect\.sid=/)

        const forged = await call(
          api.delete(`/restaurants/${a.restaurant.id}/products`, { headers: { cookie, origin: "https://evil.example" }, data: { product_ids: [a.product.id] } })
        )
        expect([forged.status, forged.data.code]).toEqual([403, "csrf_origin_rejected"])
        const noOrigin = await call(api.post("/restaurants", NEW_RESTAURANT, { headers: { cookie } }))
        expect([noOrigin.status, noOrigin.data.code]).toEqual([403, "csrf_origin_rejected"])
        // The admin routes under /v1 accept the same cookie, and had no origin check either.
        const v1 = await call(api.post("/v1/admin/marketplace/programs/prog_x/force-close", {}, { headers: { cookie, origin: "https://evil.example" } }))
        expect([v1.status, v1.data.code]).toEqual([403, "csrf_origin_rejected"])
        expect(await liveProductIds([a.product.id])).toEqual([a.product.id])
        expect(await restaurants().listRestaurants({})).toHaveLength(1)

        // The cookie alone is a signed-in admin: reads pass, and so does a write from the panel.
        const read = await call(api.get(`/restaurants/${a.restaurant.id}`, { headers: { cookie } }))
        expect([read.status, read.data.restaurant.id]).toEqual([200, a.restaurant.id])
        const fromPanel = await call(
          api.delete(`/restaurants/${a.restaurant.id}/products`, { headers: { cookie, origin: ADMIN_ORIGIN }, data: { product_ids: [a.product.id] } })
        )
        expect([fromPanel.status, fromPanel.data]).toEqual([200, { success: true }])
        expect(await liveProductIds([a.product.id])).toEqual([])
      })
    })

    describe("the other prefixes outside /store, /admin and /vendor", () => {
      it("POST /tickets/:id/verify scans a ticket for an admin only", async () => {
        const tickets = container().resolve(TICKET_BOOKING_MODULE)
        const venue = await tickets.createVenues({ name: "Hall" })
        const row = await tickets.createVenueRows({ venue_id: venue.id, row_number: "A", row_type: "standard", seat_count: 10 })
        const [product] = await products().createProducts([
          { title: "Show", handle: `show-${uid()}`, status: "published", options: [{ title: "Date", values: ["2027-03-14"] }], variants: [{ title: "v", manage_inventory: false, options: { Date: "2027-03-14" } }] },
        ])
        const ticketProduct = await tickets.createTicketProducts({ product_id: product.id, venue_id: venue.id, dates: ["2027-03-14"] })
        const variant = await tickets.createTicketProductVariants({ ticket_product_id: ticketProduct.id, product_variant_id: product.variants[0].id, row_type: "standard" })
        const seat = (seatNumber: string) =>
          tickets.createTicketPurchases({
            order_id: "order_x",
            ticket_product_id: ticketProduct.id,
            ticket_variant_id: variant.id,
            venue_row_id: row.id,
            seat_number: seatNumber,
            show_date: new Date("2027-03-14"),
          })
        const ticket = await seat("1")
        const status = async (id: string = ticket.id) => (await tickets.retrieveTicketPurchase(id)).status

        for (const [who, headers] of Object.entries({ nobody: {}, ...strangers() })) {
          for (const path of [`/tickets/${ticket.id}/verify`, `/TICKETS/${ticket.id}/verify/`]) {
            const res = await call(api.post(path, {}, headers))
            expect([who, path, res.status]).toEqual([who, path, 401])
          }
        }
        expect(await status()).toBe("pending")

        const admin = await asAdmin()
        const scanned = await call(api.post(`/tickets/${ticket.id}/verify`, {}, admin.headers))
        expect([scanned.status, scanned.data]).toEqual([200, { success: true }])
        expect(await status()).toBe("scanned")

        // The same workflow under /store. The publishable key gets a caller
        // past the framework's /store check and is not a credential: it is on
        // every page of the storefront, and /key-exchange hands it out.
        const twin = await seat("2")
        const pak = { "x-publishable-api-key": await createPublishableKeyToken(getContainer) }
        const withoutKey = await call(api.post(`/store/tickets/${twin.id}/verify`, {}))
        expect(withoutKey.status).toBe(400)
        for (const [who, headers] of Object.entries({ "the key alone": { headers: {} }, ...strangers() })) {
          for (const path of [`/store/tickets/${twin.id}/verify`, `/STORE/tickets/${twin.id}/VERIFY/`]) {
            const res = await call(api.post(path, {}, { headers: { ...headers.headers, ...pak } }))
            expect([who, path, res.status]).toEqual([who, path, 401])
          }
        }
        expect(await status(twin.id)).toBe("pending")
        const scannedTwin = await call(api.post(`/store/tickets/${twin.id}/verify`, {}, { headers: { ...admin.headers.headers, ...pak } }))
        expect([scannedTwin.status, scannedTwin.data]).toEqual([200, { success: true }])
        expect(await status(twin.id)).toBe("scanned")
      })

      it("POST /users is 401 for everyone: no middleware supplies the identity it asks for", async () => {
        const a = await seedRestaurant("a")
        const body = { actor_type: "restaurant", first_name: "Mal", last_name: "Lory", email: "mal@example.com", phone: "555", restaurant_id: a.restaurant.id }
        const admin = await asAdmin()
        for (const [who, headers] of Object.entries({ nobody: {}, admin: admin.headers, ...strangers() })) {
          const res = await call(api.post("/users", body, headers))
          expect([who, res.status]).toEqual([who, 401])
        }
        expect(await restaurants().listRestaurantAdmins({})).toEqual([])
      })

      it("the guarded groups refuse a caller with no credentials, and the public ones answer", async () => {
        const delivery = await container().resolve(DELIVERY_MODULE).createDeliveries({ transaction_id: "tx_1" })
        for (const step of ["accept", "prepare", "ready", "claim", "pick-up", "complete"]) {
          const res = await call(api.post(`/deliveries/${delivery.id}/${step}`, {}))
          expect([step, res.status]).toEqual([step, 401])
        }
        for (const [method, path] of [
          ["get", `/deliveries/${delivery.id}/subscribe`],
          ["get", "/v1/admin/marketplace/programs"],
          ["post", "/v1/admin/marketplace/payouts"],
          ["get", "/v1/seller/programs"],
          ["post", "/v1/seller/listings"],
        ] as const) {
          const res = await call(method === "get" ? api.get(path) : api.post(path, {}))
          expect([path, res.status]).toEqual([path, 401])
        }
        expect((await container().resolve(DELIVERY_MODULE).retrieveDelivery(delivery.id)).delivery_status).toBe("pending")

        // (`/health` is not in this list: the test runner mounts its own
        // "OK" ahead of the project's route, so a 200 there says nothing
        // about ours.)
        for (const path of ["/health/ready", "/key-exchange", "/product-feed", "/v1/marketplace/programs", "/v1/marketplace/services", "/v1/marketplace/listings"]) {
          const res = await call(api.get(path))
          expect([path, res.status]).toEqual([path, 200])
        }
        // Nothing private in what the public ones say: no key of any kind
        // exists here, so /key-exchange has nothing to hand out.
        expect((await call(api.get("/key-exchange"))).data).toEqual({})
      })
    })

    describe("POST /webhooks/vendor-billing/stripe believes Stripe's signature only", () => {
      const stripeEvent = (chargeId: string, secret: string) => {
        const raw = JSON.stringify({
          id: "evt_spec",
          object: "event",
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_spec", object: "payment_intent", metadata: { type: "vendor_charge", charge_id: chargeId } } },
        })
        const t = Math.floor(Date.now() / 1000)
        const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")
        return { raw, config: { headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` } } }
      }
      const pendingCharge = async () => {
        const billing = container().resolve(VENDOR_BILLING_MODULE)
        const { charge } = await billing.createCharge({ seller_id: "sel_spec", kind: "manual", amount: 5000, description: "spec", discriminator: uid() })
        const read = async () => (await billing.listVendorCharges({ id: charge.id }))[0] as { status: string; stripe_payment_intent_id: string | null }
        return { charge, read }
      }

      it("with STRIPE_WEBHOOK_SECRET unset, an event signed with the empty key is refused and the charge stays pending", async () => {
        process.env.STRIPE_SECRET_KEY = "sk_test_dummy"
        delete process.env.STRIPE_WEBHOOK_SECRET
        const { charge, read } = await pendingCharge()

        const forged = stripeEvent(charge.id, "")
        const res = await call(api.post("/webhooks/vendor-billing/stripe", forged.raw, forged.config))
        expect([res.status, res.data]).toEqual([400, { error: "Webhook verification failed" }])
        expect(await read()).toMatchObject({ status: "pending", stripe_payment_intent_id: null })
      })

      it("POST /webhooks/hawala/stripe refuses the same forgery", async () => {
        // Two things stand in the way today: no matcher preserves this route's
        // raw body, so it answers 400 to everything (Stripe included), and
        // handleWebhook refuses an unset secret. Either alone keeps this 400;
        // with both gone a verified event that matches no pending transaction
        // answers 200 { received: true }.
        process.env.STRIPE_SECRET_KEY = "sk_test_dummy"
        delete process.env.STRIPE_WEBHOOK_SECRET
        const raw = JSON.stringify({
          id: "evt_spec_ach",
          object: "event",
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_spec_ach", object: "payment_intent", metadata: { type: "ach_deposit", ledger_account_id: "acct_spec" } } },
        })
        const t = Math.floor(Date.now() / 1000)
        const v1 = createHmac("sha256", "").update(`${t}.${raw}`).digest("hex")
        const res = await call(
          api.post("/webhooks/hawala/stripe", raw, { headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` } })
        )
        expect(res.status).toBe(400)
        expect(res.data.received).toBeUndefined()
      })

      it("with the secret set, Stripe's signature settles the charge and the empty-key one still does not", async () => {
        process.env.STRIPE_SECRET_KEY = "sk_test_dummy"
        process.env.STRIPE_WEBHOOK_SECRET = "whsec_bare_prefix_spec_0123456789abcdef"
        const { charge, read } = await pendingCharge()

        const forged = stripeEvent(charge.id, "")
        const refused = await call(api.post("/webhooks/vendor-billing/stripe", forged.raw, forged.config))
        expect(refused.status).toBe(400)
        expect(await read()).toMatchObject({ status: "pending" })

        const real = stripeEvent(charge.id, process.env.STRIPE_WEBHOOK_SECRET)
        const res = await call(api.post("/webhooks/vendor-billing/stripe", real.raw, real.config))
        expect([res.status, res.data]).toEqual([200, { received: true, outcome: "paid" }])
        expect(await read()).toMatchObject({ status: "paid", stripe_payment_intent_id: "pi_spec" })
      })
    })

    describe("GET /v1/marketplace/programs/:id serves what the public list serves", () => {
      it("an open program is projected; an invite-only one, a draft and a missing id are one 404", async () => {
        const programs = container().resolve(CREATOR_PROGRAM_MODULE)
        const make = async (slug: string, programType: string, publish: boolean) => {
          const program = await programs.createProgram({
            vendorId: "sel_spec",
            title: slug,
            slug,
            programType,
            commissionPercent: 12,
            budgetCapCents: 900000,
            briefMarkdown: "private brief",
            metadata: { internal_note: "do not share" },
          })
          if (publish) await programs.publishProgram(program.id)
          return program.id as string
        }
        const open = await make("open", "affiliate_open", true)
        const invite = await make("invite", "affiliate_invite", true)
        const draft = await make("draft", "affiliate_open", false)

        const shown = await call(api.get(`/v1/marketplace/programs/${open}`))
        expect(shown.status).toBe(200)
        expect(shown.data.program).toMatchObject({ id: open, vendor_id: "sel_spec", program_type: "affiliate_open", status: "active" })
        const listed = await call(api.get("/v1/marketplace/programs"))
        expect(listed.data.programs.map((p: { id: string }) => p.id)).toEqual([open])
        // The detail shows the list's fields and the status, and none of the private columns.
        expect(Object.keys(shown.data.program).sort()).toEqual([...Object.keys(listed.data.programs[0]), "status"].sort())
        for (const body of [shown.data, listed.data]) {
          const text = JSON.stringify(body)
          for (const secret of ["budget_cap_cents", "budget_spent_cents", "brief_markdown", "private brief", "internal_note", "hold_days", "referral_level_splits", "900000"]) {
            expect(text).not.toContain(secret)
          }
        }

        for (const [label, id] of [["invite-only", invite], ["draft", draft], ["missing", "prog_does_not_exist"]]) {
          const res = await call(api.get(`/v1/marketplace/programs/${id}`))
          expect([label, res.status, res.data]).toEqual([label, 404, { message: "Program not found", type: "not_found" }])
        }
      })
    })

    describe("POST /v1/webhooks/content-platform/custom verifies the body that was sent", () => {
      it("a signature of the empty string is refused; one over the raw body is accepted", async () => {
        const secret = "s3cret-of-the-account"
        await container().resolve(CONTENT_PLATFORM_MODULE).createPlatformAccounts({
          creator_seller_id: "sel_spec",
          platform: "custom",
          external_account_id: "acct_1",
          inbound_webhook_secret: secret,
        })
        const raw = JSON.stringify({ externalAccountId: "acct_1", type: "post.metrics_updated", externalPostId: "p1", metrics: { views: 999999 } })
        const signed = (over: string, key = secret) => ({
          headers: { "content-type": "application/json", "x-fbm-signature": "sha256=" + createHmac("sha256", key).update(over).digest("hex") },
        })
        const post = (config: { headers: Record<string, string> }) => call(api.post("/v1/webhooks/content-platform/custom", raw, config))

        expect((await post({ headers: { "content-type": "application/json" } })).status).toBe(401)
        // Valid for any payload before: an HMAC of nothing.
        expect((await post(signed(""))).status).toBe(401)
        expect((await post(signed(raw, "not-the-secret"))).status).toBe(401)
        expect((await post(signed(raw.replace("999999", "1")))).status).toBe(401)

        const ok = await post(signed(raw))
        expect([ok.status, ok.data]).toEqual([200, { received: 1, snapshots_created: 0 }])
      })
    })
  },
})
