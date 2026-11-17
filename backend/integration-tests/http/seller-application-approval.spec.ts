import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import { REQUEST_MODULE } from "../../src/modules/request"
import { SELLER_EXTENSION_MODULE } from "../../src/modules/seller-extension"

jest.setTimeout(240 * 1000)

/**
 * Approving a vendor application, and filing one, against stores that exist
 * (SD-127 review), on the real server and a real migrated database.
 *
 * When the store's handle was taken, approveSeller used to look a store up by
 * the member email, then by handle, and link the applicant's login to what it
 * found: an application filed under another store's public name was approved
 * onto that store, and the applicant's next token carried its seller id. It
 * now resumes only onto a store this login already holds (an earlier approval
 * that failed after linking), and refuses otherwise with nothing linked; and
 * filing refuses a name whose handle a store already has. Approval also
 * refuses a row that seller registration would not have written: filed by a
 * login other than the one it names, or under another address.
 *
 * Approvals go through POST /admin/requests/:id/approve with an admin token;
 * the two filings spend 2 of the auth limiter's 20 a minute.
 */

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const sign = (claims: Record<string, unknown>) => {
      const secret = process.env.JWT_SECRET
      if (!secret) throw new Error("JWT_SECRET is not set in the test env")
      return jwt.sign(claims, secret, { expiresIn: "1h" })
    }
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

    async function login(prefix: string) {
      const email = `${prefix}-${uid()}@example.com`
      const auth = container().resolve(Modules.AUTH)
      await auth.register("emailpass", { body: { email, password: `Pw-${uid()}!` } } as any)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      return { email, authIdentityId: provider.auth_identity_id as string }
    }

    /** A store made the way approval makes one: Mercur links the member as the login's seller actor. */
    async function storeFor(owner: { email: string; authIdentityId: string }, name: string) {
      const { result: seller } = await createSellerWorkflow.run({
        container: container(),
        input: { auth_identity_id: owner.authIdentityId, member: { name: "Owner", email: owner.email }, seller: { name } } as any,
      })
      return seller as { id: string; name: string; handle: string }
    }

    async function adminToken() {
      const admin = await login("admin")
      const [user] = await container().resolve(Modules.USER).createUsers([{ email: admin.email }])
      await container()
        .resolve(Modules.AUTH)
        .updateAuthIdentities([{ id: admin.authIdentityId, app_metadata: { user_id: user.id } }])
      return sign({ actor_id: user.id, actor_type: "user", auth_identity_id: admin.authIdentityId, app_metadata: { user_id: user.id } })
    }

    /** A pending application as seller registration writes one, unless told otherwise. */
    async function application(
      applicant: { email: string; authIdentityId: string },
      storeName: string,
      overrides: { submitter_id?: string; memberEmail?: string } = {}
    ) {
      const [request] = await container().resolve(REQUEST_MODULE).createRequests([
        {
          type: "seller",
          status: "pending",
          submitter_id: overrides.submitter_id ?? applicant.authIdentityId,
          data: {
            auth_identity_id: applicant.authIdentityId,
            member: { name: "Applicant", email: overrides.memberEmail ?? applicant.email },
            seller: { name: storeName },
            vendor_type: "general",
          },
        },
      ])
      return request as { id: string }
    }

    const approve = async (requestId: string) =>
      call(api.post(`/admin/requests/${requestId}/approve`, {}, bearer(await adminToken())))

    const requestStatus = async (id: string) =>
      (await container().resolve(REQUEST_MODULE).listRequests({ id }))[0]?.status
    const linkedSeller = async (authIdentityId: string) => {
      const [identity] = await container().resolve(Modules.AUTH).listAuthIdentities({ id: [authIdentityId] })
      return (identity?.app_metadata ?? {}).seller_id
    }
    const stubMail = () =>
      jest.spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications").mockResolvedValue([] as any)

    afterEach(() => {
      jest.restoreAllMocks()
    })

    describe("approval", () => {
      it("an application under another store's name links nothing, changes nothing, and stays pending", async () => {
        const victim = await login("victim")
        const store = await storeFor(victim, `Victim Farm ${uid()}`)
        // `listSellerMetadata`: Medusa's pluralize leaves "Metadata" as it is, whatever the
        // generated types say (modules/seller-extension/metadata-service.ts works around the same).
        const metadataBefore = await container()
          .resolve(SELLER_EXTENSION_MODULE)
          .listSellerMetadata({ seller_id: store.id })
        const applicant = await login("applicant")
        const filed = await application(applicant, store.name)
        const mail = stubMail()

        const refused = await approve(filed.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/already exists/)

        expect(await requestStatus(filed.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBeUndefined()
        const metadataAfter = await container()
          .resolve(SELLER_EXTENSION_MODULE)
          .listSellerMetadata({ seller_id: store.id })
        expect(metadataAfter).toEqual(metadataBefore)
        expect(mail).not.toHaveBeenCalled()
      })

      it("an application from an address that is a member of that store, but not this login's, links nothing", async () => {
        const owner = await login("owner")
        const store = await storeFor(owner, `Planted Farm ${uid()}`)
        const applicant = await login("applicant")
        // A member row with the applicant's address, as an accepted invite leaves one.
        await container()
          .resolve(SELLER_MODULE)
          .createMembers([{ seller_id: store.id, name: "Planted", email: applicant.email }])
        const filed = await application(applicant, store.name)

        const refused = await approve(filed.id)
        expect(refused.status).toBe(409)
        expect(await requestStatus(filed.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBeUndefined()
      })

      it("a retried approval resumes onto the store this login already holds", async () => {
        // What an earlier approval leaves when it fails after linking the login.
        const applicant = await login("applicant")
        const store = await storeFor(applicant, `Own Farm ${uid()}`)
        expect(await linkedSeller(applicant.authIdentityId)).toMatch(/^mem_/)
        const filed = await application(applicant, store.name)
        stubMail()

        const approved = await approve(filed.id)
        expect(approved.status).toBe(200)
        expect(approved.data.seller.id).toBe(store.id)
        expect(await requestStatus(filed.id)).toBe("accepted")
        expect(await linkedSeller(applicant.authIdentityId)).toBe(store.id)
      })

      it("a row filed by someone other than the login it names is refused, as the generic request routes wrote them", async () => {
        const applicant = await login("applicant")
        const filed = await application(applicant, `Some Farm ${uid()}`, { submitter_id: "cus_someone_else" })

        const refused = await approve(filed.id)
        expect(refused.status).toBe(400)
        expect(refused.data).toMatchObject({ type: "invalid_data" })
        expect(refused.data.message).toMatch(/names a login other than the one that filed it/)
        expect(await requestStatus(filed.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBeUndefined()
      })

      it("a row whose member email is not the address of its login is refused", async () => {
        const applicant = await login("applicant")
        const filed = await application(applicant, `Other Farm ${uid()}`, { memberEmail: `victim-${uid()}@example.com` })

        const refused = await approve(filed.id)
        expect(refused.status).toBe(400)
        expect(refused.data.message).toMatch(/not the address of the login/)
        expect(await requestStatus(filed.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBeUndefined()
      })
    })

    describe("filing", () => {
      it("a store name whose handle another store has is refused, whatever its case and punctuation", async () => {
        const owner = await login("owner")
        const store = await storeFor(owner, `Victim Farm ${uid()}`)
        const applicant = await login("applicant")
        const token = sign({ actor_id: "", actor_type: "seller", auth_identity_id: applicant.authIdentityId, app_metadata: {}, user_metadata: {} })

        const refused = await call(
          api.post(
            "/auth/seller/register-request",
            { name: `${store.name.toUpperCase()}!`, member: { name: "Applicant", email: applicant.email } },
            bearer(token)
          )
        )
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/Choose another store name/)
        expect(await container().resolve(REQUEST_MODULE).listRequests({})).toHaveLength(0)
      })

      it("a login that already has a store cannot file another application", async () => {
        const owner = await login("owner")
        await storeFor(owner, `Existing Farm ${uid()}`)
        const memberId = await linkedSeller(owner.authIdentityId)
        const token = sign({
          actor_id: memberId,
          actor_type: "seller",
          auth_identity_id: owner.authIdentityId,
          app_metadata: { seller_id: memberId },
          user_metadata: {},
        })
        const mail = stubMail()

        const refused = await call(
          api.post(
            "/auth/seller/register-request",
            { name: `Second Farm ${uid()}`, member: { name: "Owner", email: owner.email } },
            bearer(token)
          )
        )
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/already has a store/)
        expect(await container().resolve(REQUEST_MODULE).listRequests({})).toHaveLength(0)
        expect(mail).not.toHaveBeenCalled()
      })
    })
  },
})
