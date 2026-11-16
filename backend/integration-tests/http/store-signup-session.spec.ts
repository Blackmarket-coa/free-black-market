import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { createPublishableKeyToken } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * The auth contract the storefront's sign-up and login rely on, on the real
 * server and a real migrated database (storefront/src/lib/data/customer.ts).
 *
 * Reported by a buyer on 2026-11-16: sign-up answered "already have an
 * account", and they could not get in. The storefront registered the email,
 * created the shopper profile with the registration token, and kept that
 * token as the session. That token was minted before the profile existed, so
 * it names no customer, and every customer route refuses it: the buyer was
 * never signed in, the form showed nothing, and a second press answered
 * "Identity with email already exists". Each case below is a step the
 * storefront now takes, or a refusal it now plans around.
 *
 * Budget: every POST under /auth and POST /store/customers spends the auth
 * limiter's 20 a minute per address (rate-limiter.ts), and a reset also the
 * strict limiter's 5 per five minutes. This file spends 12 and 2.
 */

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const claims = (token: string) => jwt.decode(token) as Record<string, any>

    // The runner empties the database after every test, so the key and the
    // region are made again before each one.
    let pak = ""
    let regionId = ""
    beforeEach(async () => {
      pak = await createPublishableKeyToken(getContainer)
      const [region] = await container()
        .resolve(Modules.REGION)
        .createRegions([{ name: `signup-${uid()}`, currency_code: "usd", countries: ["us"] }])
      regionId = region.id
    })

    const headers = (token?: string) => ({
      headers: {
        "x-publishable-api-key": pak,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })

    it("a registration token creates the profile but opens nothing else until it is refreshed", async () => {
      const email = `signup-${uid()}@example.com`
      const password = `Pw-${uid()}!`

      const registered = await api.post("/auth/customer/emailpass/register", { email, password })
      const regToken = registered.data.token as string
      expect(claims(regToken).actor_id).toBe("")

      const created = await api.post(
        "/store/customers",
        { email, first_name: "Ada", last_name: "Lovelace", phone: "5551234" },
        headers(regToken)
      )
      const customerId = created.data.customer.id as string
      expect(created.data.customer.has_account).toBe(true)

      // The session the storefront used to keep: refused everywhere a buyer goes.
      const meWithReg = await call(api.get("/store/customers/me", headers(regToken)))
      expect(meWithReg.status).toBe(401)

      const cart = await api.post("/store/carts", { region_id: regionId }, headers())
      const moveWithReg = await call(
        api.post(`/store/carts/${cart.data.cart.id}/customer`, {}, headers(regToken))
      )
      expect(moveWithReg.status).toBe(401)

      // What the storefront does now: trade it for a token that names the customer.
      const refreshed = await api.post("/auth/token/refresh", {}, headers(regToken))
      const sessionToken = refreshed.data.token as string
      expect(claims(sessionToken).actor_id).toBe(customerId)

      const me = await api.get("/store/customers/me", headers(sessionToken))
      expect(me.data.customer).toMatchObject({ id: customerId, email, first_name: "Ada" })

      const moved = await api.post(`/store/carts/${cart.data.cart.id}/customer`, {}, headers(sessionToken))
      expect(moved.data.cart.customer_id).toBe(customerId)
    })

    it("a second sign-up with the same email is refused by name, and the password still signs in", async () => {
      const email = `signup-${uid()}@example.com`
      const password = `Pw-${uid()}!`

      const registered = await api.post("/auth/customer/emailpass/register", { email, password })
      const created = await api.post("/store/customers", { email }, headers(registered.data.token))
      const customerId = created.data.customer.id as string

      // The storefront matches this message exactly to know the email is taken.
      const again = await call(api.post("/auth/customer/emailpass/register", { email, password }))
      expect(again.status).toBe(401)
      expect(again.data.message).toBe("Identity with email already exists")

      const login = await api.post("/auth/customer/emailpass", { email, password })
      expect(claims(login.data.token).actor_id).toBe(customerId)

      const wrong = await call(api.post("/auth/customer/emailpass", { email, password: `${password}x` }))
      expect(wrong.status).toBe(401)
    })

    it("a sign-up that stopped after the login was made can be finished from a login", async () => {
      const email = `signup-${uid()}@example.com`
      const password = `Pw-${uid()}!`

      await api.post("/auth/customer/emailpass/register", { email, password })

      // The password signs in, but the token names no customer and /me refuses it.
      const login = await api.post("/auth/customer/emailpass", { email, password })
      const loginToken = login.data.token as string
      expect(claims(loginToken).actor_id).toBe("")
      expect(claims(loginToken).app_metadata ?? {}).toEqual({})
      const meBefore = await call(api.get("/store/customers/me", headers(loginToken)))
      expect(meBefore.status).toBe(401)

      // The storefront's login now creates the profile with that token, then refreshes.
      const created = await api.post("/store/customers", { email }, headers(loginToken))
      const refreshed = await api.post("/auth/token/refresh", {}, headers(loginToken))
      expect(claims(refreshed.data.token).actor_id).toBe(created.data.customer.id)
      const me = await api.get("/store/customers/me", headers(refreshed.data.token))
      expect(me.data.customer.email).toBe(email)
    })

    it("a reset for a login with no profile is sent, whatever the case of the address typed", async () => {
      const email = `signup-${uid()}@example.com`
      await api.post("/auth/customer/emailpass/register", { email, password: `Pw-${uid()}!` })

      const received: Array<Record<string, unknown>> = []
      container()
        .resolve(Modules.EVENT_BUS)
        .subscribe("auth.password_reset", async (event: any) => {
          received.push(event?.data ?? event)
        })

      const typed = email.replace(/^s/, "S").toUpperCase()
      const reset = await api.post("/auth/customer/emailpass/reset-password", { identifier: typed })
      expect(reset.status).toBe(201)

      // An address with no login answers the same, and sends nothing.
      const stranger = await api.post("/auth/customer/emailpass/reset-password", {
        identifier: `nobody-${uid()}@example.com`,
      })
      expect(stranger.status).toBe(201)

      const deadline = Date.now() + 10_000
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      // Let a second (wrong) emission land if there were one.
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({ entity_id: email, actor_type: "customer" })
      expect(typeof received[0].token).toBe("string")
    })
  },
})
