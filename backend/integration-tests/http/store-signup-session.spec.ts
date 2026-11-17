import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { REQUEST_MODULE } from "../../src/modules/request"
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
 * The deletion cases are the other half: once the storefront can attach a
 * shopper profile to an existing login, its own "Delete my account" must not
 * take that login away from a vendor or a staff member who signs in with the
 * same email and password, and must not let a stranger keep a shopper's login
 * alive by filing a vendor application in their name (lib/login-shared.ts).
 *
 * Budget: every POST under /auth and POST /store/customers spends the auth
 * limiter's 20 a minute per address (rate-limiter.ts), and a reset also the
 * strict limiter's 5 per five minutes. This file spends 13 and 2; the deletion
 * cases build their logins and profiles through the modules to stay inside it.
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

    const sign = (claims: Record<string, unknown>) => {
      const secret = process.env.JWT_SECRET
      if (!secret) throw new Error("JWT_SECRET is not set in the test env")
      return jwt.sign(claims, secret, { expiresIn: "1h" })
    }

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

    it("a reset for a login with no profile reaches the mailer, whatever the case of the address typed", async () => {
      const email = `signup-${uid()}@example.com`
      await api.post("/auth/customer/emailpass/register", { email, password: `Pw-${uid()}!` })

      // The subscriber (src/subscribers/password-reset.ts) builds the link from
      // STOREFRONT_URL and drops the mail when it is unset; the notification
      // module is stubbed so no provider is needed.
      const savedStorefront = process.env.STOREFRONT_URL
      process.env.STOREFRONT_URL = "https://shop.signup-spec.test"
      const sent = jest
        .spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications")
        .mockResolvedValue([] as any)

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

      try {
        const deadline = Date.now() + 10_000
        while ((received.length === 0 || sent.mock.calls.length === 0) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        // Let a second (wrong) emission land if there were one.
        await new Promise((resolve) => setTimeout(resolve, 500))
        expect(received).toHaveLength(1)
        expect(received[0]).toMatchObject({ entity_id: email, actor_type: "customer" })
        expect(typeof received[0].token).toBe("string")

        expect(sent).toHaveBeenCalledTimes(1)
        expect(sent).toHaveBeenCalledWith(
          expect.objectContaining({
            to: email,
            channel: "email",
            template: "password-reset",
            data: expect.objectContaining({
              reset_url: `https://shop.signup-spec.test/reset-password?token=${received[0].token}`,
            }),
          })
        )
      } finally {
        sent.mockRestore()
        if (savedStorefront === undefined) delete process.env.STOREFRONT_URL
        else process.env.STOREFRONT_URL = savedStorefront
      }
    })

    /**
     * A login with a shopper profile attached, built through the modules (the
     * routes would spend the auth limiter), and a customer token for it.
     */
    async function shopperOnLogin(extraAppMetadata: Record<string, unknown> = {}) {
      const email = `deletion-${uid()}@example.com`
      const password = `Pw-${uid()}!`
      const auth = container().resolve(Modules.AUTH)
      // The provider the register route calls, without spending the route's
      // limiter: the password is hashed the same way, so it signs in later.
      const registered = await auth.register("emailpass", { body: { email, password } } as any)
      expect(registered.success).toBe(true)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      const authIdentityId = provider.auth_identity_id as string
      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers([{ email, first_name: "Del", has_account: true }])
      const appMetadata = { ...extraAppMetadata, customer_id: customer.id }
      await auth.updateAuthIdentities([{ id: authIdentityId, app_metadata: appMetadata }])
      const token = sign({
        actor_id: customer.id,
        actor_type: "customer",
        auth_identity_id: authIdentityId,
        app_metadata: appMetadata,
      })
      return { email, password, authIdentityId, providerIdentityId: provider.id as string, customer, token }
    }

    const identityOf = async (id: string) => {
      const found = await container().resolve(Modules.AUTH).listAuthIdentities({ id: [id] })
      return found[0] ?? null
    }

    it("deleting the shopper account of a vendor's login keeps the login and unlinks the profile", async () => {
      const shopper = await shopperOnLogin({ seller_id: "sel_signup_spec" })

      const deleted = await api.post("/store/customers/me/deletion", {}, headers(shopper.token))
      expect(deleted.data).toMatchObject({ deleted: true, login_revoked: false, login_kept: true, profile_unlinked: true })

      const identity = await identityOf(shopper.authIdentityId)
      expect(identity).not.toBeNull()
      expect(identity.app_metadata).toMatchObject({ seller_id: "sel_signup_spec", customer_id: null })

      // The vendor still signs in with the same email and password.
      const vendorLogin = await api.post("/auth/seller/emailpass", {
        email: shopper.email,
        password: shopper.password,
      })
      expect(claims(vendorLogin.data.token).actor_id).toBe("sel_signup_spec")

      // The profile itself is erased as before.
      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .listCustomers({ id: [shopper.customer.id] })
      expect(customer.email).toBe(`deleted-${shopper.customer.id}@deleted.invalid`)
    })

    it("a vendor application filed in a shopper's name does not keep their login, and goes with it", async () => {
      const shopper = await shopperOnLogin()
      // What POST /auth/seller/register-request files for whatever login the
      // email in its body names, with no token.
      const requests = container().resolve(REQUEST_MODULE)
      const filed = await requests.createRequests([
        {
          type: "seller",
          submitter_id: shopper.authIdentityId,
          data: { member: { name: "Mallory", email: shopper.email } },
          status: "pending",
        },
        // The older name for the same application, refused earlier.
        { type: "seller_creation", submitter_id: shopper.authIdentityId, data: {}, status: "rejected" },
      ])

      const deleted = await api.post("/store/customers/me/deletion", {}, headers(shopper.token))
      expect(deleted.data).toMatchObject({
        login_revoked: true,
        login_kept: false,
        seller_requests_removed: 2,
      })
      expect(await identityOf(shopper.authIdentityId)).toBeNull()
      expect(await requests.listRequests({ id: filed.map((r: any) => r.id) })).toHaveLength(0)
    })

    it("deleting the shopper account of a vendor team member whose login never got seller_id keeps the login", async () => {
      const shopper = await shopperOnLogin()
      // What approval leaves behind for vendors whose login was not linked: a
      // member row with the applicant's email (here in another case).
      const sellers = container().resolve(SELLER_MODULE)
      const [seller] = await sellers.createSellers([{ name: "Spec Farm", handle: `spec-farm-${uid()}` }])
      await sellers.createMembers([{ seller_id: seller.id, name: "Owner", email: shopper.email.toUpperCase() }])

      const deleted = await api.post("/store/customers/me/deletion", {}, headers(shopper.token))
      expect(deleted.data).toMatchObject({ login_revoked: false, login_kept: true, profile_unlinked: true })
      const identity = await identityOf(shopper.authIdentityId)
      expect(identity.app_metadata).toMatchObject({ customer_id: null })
    })

    it("when the check cannot be made, nothing changes and the person is asked to retry", async () => {
      const shopper = await shopperOnLogin()
      const auth = container().resolve(Modules.AUTH)
      const failing = jest.spyOn(auth, "listAuthIdentities").mockRejectedValueOnce(new Error("db down"))
      try {
        const refused = await call(api.post("/store/customers/me/deletion", {}, headers(shopper.token)))
        expect(refused.status).toBe(503)
        expect(refused.data.message).toMatch(/Nothing was changed/)
      } finally {
        failing.mockRestore()
      }

      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .listCustomers({ id: [shopper.customer.id] })
      expect(customer.email).toBe(shopper.email)
      const identity = await identityOf(shopper.authIdentityId)
      expect(identity.app_metadata).toMatchObject({ customer_id: shopper.customer.id })

      // And the retry goes through.
      const retried = await api.post("/store/customers/me/deletion", {}, headers(shopper.token))
      expect(retried.data).toMatchObject({ deleted: true, login_revoked: true })
    })

    it("deleting a shopper-only account still revokes the login", async () => {
      const shopper = await shopperOnLogin()

      const deleted = await api.post("/store/customers/me/deletion", {}, headers(shopper.token))
      expect(deleted.data).toMatchObject({
        login_revoked: true,
        login_kept: false,
        profile_unlinked: false,
        seller_requests_removed: 0,
      })
      expect(await identityOf(shopper.authIdentityId)).toBeNull()
    })
  },
})
