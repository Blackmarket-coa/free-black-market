import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../../src/modules/request"
import { createPublishableKeyToken } from "./_publishable-key"

jest.setTimeout(240 * 1000)

/**
 * Registering an address that already has a login, on the real server and a
 * real migrated database (SD-127 follow-up).
 *
 * Medusa's emailpass provider treats an existing login whose app_metadata is
 * empty as "still claimable": `POST /auth/:actor_type/emailpass/register`
 * replaced its password with the one in the body and returned a token for it.
 * Anyone who knew the address of a login with no actor (every vendor applicant
 * until approval, a shopper whose sign-up stopped after the login was made)
 * could take it over. middlewares/refuse-taken-email-registration.ts now
 * answers every taken address the way Medusa answers one whose login has an
 * actor, and the two sign-ups that meet that answer sign in instead: the
 * storefront's (storefront/src/lib/data/customer.ts) and the vendor panel's
 * (vendor-panel/src/hooks/api/auth.tsx).
 *
 * Budget: every POST under /auth, and POST /store/customers, spends the auth
 * limiter's 20 a minute per address (rate-limiter.ts). This file spends 14;
 * the logins it does not register through the route are built through the
 * auth module.
 */

/** What Medusa's register route answers for a taken address (its error handler, read). */
const TAKEN = { type: "unauthorized", message: "Identity with email already exists" }

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const claims = (token: string) => jwt.decode(token) as Record<string, any>
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

    /** A login with no actor, as a sign-up that stopped after register leaves it. */
    async function loginWithNoActor() {
      const email = `claimable-${uid()}@example.com`
      const password = `Owner-${uid()}!`
      const auth = container().resolve(Modules.AUTH)
      const registered = await auth.register("emailpass", { body: { email, password } } as any)
      expect(registered.success).toBe(true)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      const [identity] = await auth.listAuthIdentities({ id: [provider.auth_identity_id] })
      expect(identity.app_metadata ?? {}).toEqual({})
      return { email, password, authIdentityId: provider.auth_identity_id as string }
    }

    it("a login with no actor cannot be re-registered with another password, and its own password still signs in", async () => {
      const owner = await loginWithNoActor()
      const stranger = `Stranger-${uid()}!`

      // Any actor type: the login is shared between them.
      for (const actor of ["seller", "customer"]) {
        const refused = await call(api.post(`/auth/${actor}/emailpass/register`, { email: owner.email, password: stranger }))
        expect({ actor, status: refused.status, body: refused.data }).toEqual({ actor, status: 401, body: TAKEN })
      }

      // The address as typed in another case is the same login: the `/auth/*`
      // entry lower-cases it before the check runs.
      const shouted = await call(
        api.post("/auth/seller/emailpass/register", { email: owner.email.toUpperCase(), password: stranger })
      )
      expect(shouted.status).toBe(401)

      const asStranger = await call(api.post("/auth/seller/emailpass", { email: owner.email, password: stranger }))
      expect(asStranger.status).toBe(401)
      const asOwner = await api.post("/auth/seller/emailpass", { email: owner.email, password: owner.password })
      expect(claims(asOwner.data.token).auth_identity_id).toBe(owner.authIdentityId)
    })

    it("a login with an actor gets the same answer, as Medusa itself gives it", async () => {
      const auth = container().resolve(Modules.AUTH)
      const email = `shopper-${uid()}@example.com`
      await auth.register("emailpass", { body: { email, password: `Pw-${uid()}!` } } as any)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      const [customer] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email, has_account: true }])
      await auth.updateAuthIdentities([{ id: provider.auth_identity_id, app_metadata: { customer_id: customer.id } }])

      const refused = await call(api.post("/auth/customer/emailpass/register", { email, password: `Other-${uid()}!` }))
      expect(refused.status).toBe(401)
      expect(refused.data).toEqual(TAKEN)
    })

    it("a new address still registers", async () => {
      const email = `new-${uid()}@example.com`
      const registered = await api.post("/auth/seller/emailpass/register", { email, password: `Pw-${uid()}!` })
      expect(registered.status).toBe(200)
      expect(claims(registered.data.token)).toMatchObject({ actor_type: "seller", actor_id: "" })
      const [provider] = await container()
        .resolve(Modules.AUTH)
        .listProviderIdentities({ entity_id: email, provider: "emailpass" })
      expect(provider.auth_identity_id).toBe(claims(registered.data.token).auth_identity_id)
    })

    it("the vendor panel's sign-up for a login with no actor: register is refused, sign-in works, the application is filed", async () => {
      const owner = await loginWithNoActor()

      // useSignUpWithEmailPass matches "already exists" and signs in with the typed password.
      const refused = await call(api.post("/auth/seller/emailpass/register", { email: owner.email, password: owner.password }))
      expect(refused.status).toBe(401)
      expect(String(refused.data.message).toLowerCase()).toContain("already exists")

      const login = await api.post("/auth/seller/emailpass", { email: owner.email, password: owner.password })
      const token = login.data.token as string
      expect(claims(token)).toMatchObject({ actor_type: "seller", actor_id: "", auth_identity_id: owner.authIdentityId })

      jest
        .spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications")
        .mockResolvedValue([] as any)
      try {
        const filed = await api.post(
          "/auth/seller/register-request",
          { name: "Owner Farm", member: { name: "Owner", email: owner.email } },
          bearer(token)
        )
        expect(filed.status).toBe(201)
      } finally {
        jest.restoreAllMocks()
      }
      const [request] = await container().resolve(REQUEST_MODULE).listRequests({ type: "seller" })
      expect(request.submitter_id).toBe(owner.authIdentityId)
    })

    it("the storefront's sign-up for a login with no actor: register is refused by name, sign-in works, the profile is finished", async () => {
      const owner = await loginWithNoActor()
      const pak = await createPublishableKeyToken(getContainer)
      const store = (token?: string) => ({
        headers: { "x-publishable-api-key": pak, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      })

      // signup() compares the message exactly (isIdentityExists), then signs in.
      const refused = await call(
        api.post("/auth/customer/emailpass/register", { email: owner.email, password: owner.password })
      )
      expect(refused.status).toBe(401)
      expect(refused.data.message).toBe("Identity with email already exists")

      const login = await api.post("/auth/customer/emailpass", { email: owner.email, password: owner.password })
      const loginToken = login.data.token as string
      expect(claims(loginToken).actor_id).toBe("")

      const created = await api.post("/store/customers", { email: owner.email, first_name: "Ola" }, store(loginToken))
      const refreshed = await api.post("/auth/token/refresh", {}, store(loginToken))
      expect(claims(refreshed.data.token).actor_id).toBe(created.data.customer.id)
      const me = await api.get("/store/customers/me", store(refreshed.data.token))
      expect(me.data.customer.email).toBe(owner.email)
    })
  },
})
