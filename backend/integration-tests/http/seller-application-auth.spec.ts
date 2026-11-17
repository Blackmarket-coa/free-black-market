import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../../src/modules/request"
import { REQUEST_TYPES } from "../../src/modules/request/validators"
import { createPublishableKeyToken } from "./_publishable-key"
import { createAuthenticatedSeller } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * Who a vendor application is filed for (SD-127), on the real server and a
 * real migrated database.
 *
 * `handleSellerRegistration` (src/api/shared/seller-registration.ts) used to
 * pick the login by the email in the request body, never by the caller's
 * token, so anyone could file a pending application, and have its
 * verification mail sent, in the name of any login whose address they knew.
 * It now files for the login of the caller's own seller token and refuses a
 * body email that is not that login's address.
 *
 * The three routes that file one are covered. `POST /auth/seller/register-
 * request` is what the vendor panel's sign-up calls (vendor-panel/src/hooks/
 * api/auth.tsx), with the token it just got from register or login.
 * `POST /vendor/register` sits behind Mercur's `/vendor/*` guard, which only
 * lets a seller's token through. `POST /vendor/sellers` (the project's
 * override of Mercur's route) is reached by any seller token, a throwaway
 * registration's included, and had its own copy of the body-email lookup.
 * The generic `POST /store/requests` and `POST /vendor/requests` refuse the
 * seller types outright.
 *
 * Budget: every POST under /auth spends the auth limiter's 20 a minute per
 * address (rate-limiter.ts). This file spends 18; the logins it does not need
 * a route for are built through the auth module. `POST /vendor/sellers` has
 * the registration limiter's 5 per 15 minutes, and this file spends 2.
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

    const sign = (payload: Record<string, unknown>, secret = process.env.JWT_SECRET) => {
      if (!secret) throw new Error("JWT_SECRET is not set in the test env")
      return jwt.sign(payload, secret, { expiresIn: "1h" })
    }
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

    /** The claims `POST /auth/seller/emailpass/register` puts in its token: no actor yet. */
    const registrationClaims = (authIdentityId: string) => ({
      actor_id: "",
      actor_type: "seller",
      auth_identity_id: authIdentityId,
      auth_provider: "emailpass",
      app_metadata: {},
      user_metadata: {},
    })

    /** What the vendor panel's sign-up sends (useSignUpWithEmailPass). */
    const application = (email: string, name = "Ada") => ({
      name: `${name}'s Farm`,
      vendor_type: "producer",
      playbook: "cycle",
      node_operator_opt_in: false,
      member: { name, email },
    })

    /** A login with no actor yet, built through the auth module so it spends none of the limiter. */
    async function loginViaModule(prefix = "vendor") {
      const email = `${prefix}-${uid()}@example.com`
      const password = `Pw-${uid()}!`
      const auth = container().resolve(Modules.AUTH)
      const registered = await auth.register("emailpass", { body: { email, password } } as any)
      expect(registered.success).toBe(true)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      return { email, password, authIdentityId: provider.auth_identity_id as string }
    }

    /** A storefront shopper: a login with a customer profile linked, as sign-up leaves it. */
    async function shopperViaModule() {
      const login = await loginViaModule("shopper")
      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers([{ email: login.email, first_name: "Sam", has_account: true }])
      await container()
        .resolve(Modules.AUTH)
        .updateAuthIdentities([{ id: login.authIdentityId, app_metadata: { customer_id: customer.id } }])
      return { ...login, customerId: customer.id as string }
    }

    /** Stub the mailer and return the spy; restored after each test. */
    const stubMail = () =>
      jest
        .spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications")
        .mockResolvedValue([] as any)

    const allRequests = () => container().resolve(REQUEST_MODULE).listRequests({})

    afterEach(() => {
      jest.restoreAllMocks()
    })

    describe("POST /auth/seller/register-request", () => {
      it("with no seller token, an application in a shopper's name is refused and nothing is written or sent", async () => {
        const shopper = await shopperViaModule()
        const mail = stubMail()

        // What the review of SD-126 reproduced: no token at all.
        const anonymous = await call(api.post("/auth/seller/register-request", application(shopper.email, "Mallory")))
        expect(anonymous.status).toBe(401)

        // A token this server did not sign.
        const forged = await call(
          api.post(
            "/auth/seller/register-request",
            application(shopper.email, "Mallory"),
            bearer(sign(registrationClaims(shopper.authIdentityId), "not-the-server-secret"))
          )
        )
        expect(forged.status).toBe(401)

        // A real-looking token for a login that no longer exists.
        const orphan = await call(
          api.post(
            "/auth/seller/register-request",
            application(shopper.email, "Mallory"),
            bearer(sign(registrationClaims("authid_gone")))
          )
        )
        expect(orphan.status).toBe(401)

        expect(await allRequests()).toHaveLength(0)
        expect(mail).not.toHaveBeenCalled()
      })

      it("a shopper's customer token is refused: an application takes a seller token", async () => {
        const shopper = await shopperViaModule()
        const customerToken = sign({
          actor_id: shopper.customerId,
          actor_type: "customer",
          auth_identity_id: shopper.authIdentityId,
          auth_provider: "emailpass",
          app_metadata: { customer_id: shopper.customerId },
          user_metadata: {},
        })

        const refused = await call(
          api.post("/auth/seller/register-request", application(shopper.email), bearer(customerToken))
        )
        expect(refused.status).toBe(401)
        expect(await allRequests()).toHaveLength(0)
      })

      it("the vendor panel's sign-up files the application for the login it registered, once", async () => {
        const email = `vendor-${uid()}@example.com`
        const registered = await api.post("/auth/seller/emailpass/register", { email, password: `Pw-${uid()}!` })
        const token = registered.data.token as string
        const authIdentityId = claims(token).auth_identity_id as string
        expect(claims(token)).toMatchObject({ actor_type: "seller", actor_id: "" })

        // The panel asks first, then files.
        const before = await api.get("/auth/seller/registration-status", bearer(token))
        expect(before.data.status).toBe("no_request")

        const mail = stubMail()
        const filed = await api.post("/auth/seller/register-request", application(email), bearer(token))
        expect(filed.status).toBe(201)

        const [request] = await allRequests()
        expect(request).toMatchObject({ id: filed.data.request.id, type: "seller", status: "pending", submitter_id: authIdentityId })
        expect(request.data).toMatchObject({
          auth_identity_id: authIdentityId,
          member: { name: "Ada", email },
          seller: { name: "Ada's Farm" },
          playbook: "cycle",
        })
        expect(typeof request.data.email_verification?.token_hash).toBe("string")
        expect(mail).toHaveBeenCalledTimes(1)
        expect(mail).toHaveBeenCalledWith(
          expect.objectContaining({ to: email, template: "seller-email-verification" }),
          expect.anything()
        )

        // The panel's status check sees it as the applicant's own.
        const after = await api.get("/auth/seller/registration-status", bearer(token))
        expect(after.data).toMatchObject({ status: "pending", request_id: request.id })

        // Pressing again answers with the same application and files no second one.
        const again = await api.post("/auth/seller/register-request", application(email), bearer(token))
        expect(again.status).toBe(200)
        expect(again.data.request.id).toBe(request.id)
        expect(await allRequests()).toHaveLength(1)
        expect(mail).toHaveBeenCalledTimes(1)
      })

      it("a shopper whose email is taken signs in as a seller and applies; the address matches whatever its case", async () => {
        const shopper = await shopperViaModule()

        // The panel's path when register says the email is taken: sign in instead.
        const taken = await call(
          api.post("/auth/seller/emailpass/register", { email: shopper.email, password: shopper.password })
        )
        expect(taken.status).toBe(401)
        expect(taken.data.message).toBe("Identity with email already exists")
        const login = await api.post("/auth/seller/emailpass", { email: shopper.email, password: shopper.password })
        const token = login.data.token as string
        expect(claims(token)).toMatchObject({ actor_type: "seller", actor_id: "", auth_identity_id: shopper.authIdentityId })

        stubMail()
        const filed = await api.post(
          "/auth/seller/register-request",
          application(shopper.email.toUpperCase()),
          bearer(token)
        )
        expect(filed.status).toBe(201)

        const [request] = await allRequests()
        expect(request.submitter_id).toBe(shopper.authIdentityId)
        // Stored as the login's own address, the one approval matches on.
        expect(request.data.member.email).toBe(shopper.email)
      })

      it("your own seller token cannot file for another address, and the answer does not say whether that address has a login", async () => {
        const email = `vendor-${uid()}@example.com`
        const registered = await api.post("/auth/seller/emailpass/register", { email, password: `Pw-${uid()}!` })
        const token = registered.data.token as string
        const victim = await shopperViaModule()
        const mail = stubMail()

        const forVictim = await call(
          api.post("/auth/seller/register-request", application(victim.email, "Mallory"), bearer(token))
        )
        expect(forVictim.status).toBe(403)

        const forNobody = await call(
          api.post("/auth/seller/register-request", application(`nobody-${uid()}@example.com`, "Mallory"), bearer(token))
        )
        expect(forNobody.status).toBe(403)
        expect(forNobody.data).toEqual(forVictim.data)

        expect(await allRequests()).toHaveLength(0)
        expect(mail).not.toHaveBeenCalled()
      })
    })

    describe("POST /vendor/register", () => {
      it("Mercur's vendor guard stops a caller with no token, or with no seller yet, before the handler", async () => {
        // Not this fix: `/vendor/*` is guarded by @mercurjs/b2c-core, which runs
        // before ensureSellerContext. Pinned so a change to that order is seen.
        const shopper = await shopperViaModule()
        const anonymous = await call(api.post("/vendor/register", application(shopper.email, "Mallory")))
        expect(anonymous.status).toBe(401)

        const me = await loginViaModule("vendor")
        const noSellerYet = await call(
          api.post("/vendor/register", application(me.email), bearer(sign(registrationClaims(me.authIdentityId))))
        )
        expect(noSellerYet.status).toBe(403)
        expect(noSellerYet.data.message).toBe("Seller is not active")

        expect(await allRequests()).toHaveLength(0)
      })

      it("a seller's token cannot file an application in another login's name", async () => {
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const victim = await shopperViaModule()
        const mail = stubMail()

        const refused = await call(
          api.post("/vendor/register", application(victim.email, "Mallory"), bearer(seller.token))
        )
        expect(refused.status).toBe(403)
        expect(await allRequests()).toHaveLength(0)
        expect(mail).not.toHaveBeenCalled()
      })
    })

    describe("POST /vendor/sellers", () => {
      it("a throwaway login's token cannot file in a shopper's name, and files for its own login", async () => {
        const victim = await shopperViaModule()
        // Mercur's strict body for this path: no vendor_type or playbook.
        const forVictim = { name: "Mallory Farm", member: { name: "Mallory", email: victim.email } }

        const anonymous = await call(api.post("/vendor/sellers", forVictim))
        expect(anonymous.status).toBe(401)

        // Anyone can get this token: register any address.
        const throwaway = `throwaway-${uid()}@example.com`
        const registered = await api.post("/auth/seller/emailpass/register", { email: throwaway, password: `Pw-${uid()}!` })
        const token = registered.data.token as string
        const mail = stubMail()

        const refused = await call(api.post("/vendor/sellers", forVictim, bearer(token)))
        expect(refused.status).toBe(403)
        expect(await allRequests()).toHaveLength(0)
        expect(mail).not.toHaveBeenCalled()

        const own = await api.post(
          "/vendor/sellers",
          { name: "Tess Farm", member: { name: "Tess", email: throwaway } },
          bearer(token)
        )
        expect(own.status).toBe(201)
        const [request] = await allRequests()
        expect(request).toMatchObject({ type: "seller", status: "pending", submitter_id: claims(token).auth_identity_id })
        expect(request.data.member).toEqual({ name: "Tess", email: throwaway })
        expect(mail).toHaveBeenCalledWith(
          expect.objectContaining({ to: throwaway, template: "seller-email-verification" }),
          expect.anything()
        )
      })
    })

    describe("the generic request routes", () => {
      // Both used to file any type with any data. Approving a seller type
      // creates a seller for whatever login and address the data names
      // (approveSeller reads data.auth_identity_id): measured, a customer's
      // made a seller with another person's email, on the customer's login,
      // and mailed that person.
      // In any case and padding, too: the refusal is not an exact-match deny-list.
      const sellerTypes = [REQUEST_TYPES.SELLER, REQUEST_TYPES.SELLER_CREATION, " Seller", "SELLER_CREATION "]

      it("POST /store/requests refuses a seller application, and still takes other requests", async () => {
        const shopper = await shopperViaModule()
        const pak = await createPublishableKeyToken(getContainer)
        const asShopper = {
          headers: {
            "x-publishable-api-key": pak,
            authorization: `Bearer ${sign({
              actor_id: shopper.customerId,
              actor_type: "customer",
              auth_identity_id: shopper.authIdentityId,
              auth_provider: "emailpass",
              app_metadata: { customer_id: shopper.customerId },
              user_metadata: {},
            })}`,
          },
        }
        const data = {
          auth_identity_id: shopper.authIdentityId,
          member: { name: "Victim", email: `victim-${uid()}@example.com` },
          seller: { name: "Victim Farm" },
        }

        for (const type of sellerTypes) {
          const refused = await call(api.post("/store/requests", { type, data }, asShopper))
          expect({ type, status: refused.status }).toEqual({ type, status: 400 })
          expect(refused.data).toMatchObject({
            message: "Validation failed",
            errors: [expect.objectContaining({ path: ["type"] })],
          })
        }
        expect(await allRequests()).toHaveLength(0)

        const quote = await api.post("/store/requests", { type: REQUEST_TYPES.QUOTE_REQUEST, data: { note: "ten crates" } }, asShopper)
        expect(quote.status).toBe(201)
      })

      it("POST /vendor/requests refuses a seller application, and still takes other requests", async () => {
        const seller = await createAuthenticatedSeller({ api, getContainer })
        const victim = await shopperViaModule()
        const data = {
          auth_identity_id: victim.authIdentityId,
          member: { name: "Victim", email: victim.email },
          seller: { name: "Victim Farm" },
        }

        for (const type of sellerTypes) {
          const refused = await call(api.post("/vendor/requests", { request: { type, data } }, bearer(seller.token)))
          expect({ type, status: refused.status }).toEqual({ type, status: 400 })
          expect(refused.data).toMatchObject({
            message: "Validation failed",
            errors: [expect.objectContaining({ path: ["request", "type"] })],
          })
        }
        expect(await allRequests()).toHaveLength(0)

        // What the panel files here (vendor-panel/src/hooks/api/product-types.tsx).
        const productType = await api.post(
          "/vendor/requests",
          { request: { type: "product_type", data: { value: "Preserves" } } },
          bearer(seller.token)
        )
        expect(productType.status).toBe(201)
      })
    })
  },
})
