import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules, toHandle } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow, deleteMemberWorkflow } from "@mercurjs/b2c-core/workflows"
import { REQUEST_MODULE } from "../../src/modules/request"
import { SELLER_EXTENSION_MODULE } from "../../src/modules/seller-extension"
import { listSellerMetadataRecords } from "../../src/modules/seller-extension/metadata-service"
import { PLAYBOOK_MODULE } from "../../src/modules/playbook"
import { STORE_NAME_NEEDS_LATIN } from "../../src/shared/store-handle"

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
 * Resuming needs the store to be the one an approval of this application
 * made (its first member is the applicant's owner, and no other application
 * of the login was approved), so an invite into a same-named store, as owner
 * too, is refused. A link to a member removed from a store that is still open
 * is no link: the login files and is approved onto a store of its own. A
 * store name with no Latin letter or digit is refused, at filing and at
 * approval, because its handle would have none.
 *
 * A name whose handle another store has is refused naming that handle, the
 * store's web address: names that differ only outside a-z and 0-9 share one.
 *
 * Approvals go through POST /admin/requests/:id/approve with an admin token;
 * the filings spend 14 of the auth limiter's 20 a minute.
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
      overrides: { submitter_id?: string; memberEmail?: string; status?: string } = {}
    ) {
      const [request] = await container().resolve(REQUEST_MODULE).createRequests([
        {
          type: "seller",
          status: overrides.status ?? "pending",
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

    /**
     * The two writes Mercur's acceptMemberInvitesWorkflow makes: a member row
     * with the invite's address and role, and the login linked to it. Mercur's
     * invite takes role "owner", and nothing checks who sends one.
     */
    async function acceptInvite(
      invitee: { email: string; authIdentityId: string },
      store: { id: string },
      role: "owner" | "admin" | "member" = "member"
    ) {
      const [member] = await container()
        .resolve(SELLER_MODULE)
        .createMembers([{ seller_id: store.id, name: "Invitee", email: invitee.email, role }])
      await container()
        .resolve(Modules.AUTH)
        .updateAuthIdentities([{ id: invitee.authIdentityId, app_metadata: { seller_id: member.id } }])
      return member as { id: string }
    }

    /** What POST /auth/seller/emailpass/register hands a new login: no actor yet. */
    const registrationToken = (who: { authIdentityId: string }) =>
      sign({ actor_id: "", actor_type: "seller", auth_identity_id: who.authIdentityId, app_metadata: {}, user_metadata: {} })

    const file = (who: { email: string; authIdentityId: string }, storeName: string, token = registrationToken(who)) =>
      call(
        api.post(
          "/auth/seller/register-request",
          { name: storeName, member: { name: "Applicant", email: who.email } },
          bearer(token)
        )
      )

    /** What signing in hands a login whose link names a member: that member as the actor. */
    const memberToken = (who: { authIdentityId: string }, memberId: string) =>
      sign({ actor_id: memberId, actor_type: "seller", auth_identity_id: who.authIdentityId, app_metadata: { seller_id: memberId }, user_metadata: {} })
    const registrationStatus = async (token: string) =>
      (await call(api.get("/auth/seller/registration-status", bearer(token)))).data

    const sellersWithHandle = async (name: string) =>
      container().resolve(SELLER_MODULE).listSellers({ handle: toHandle(name) })
    const metadataOf = async (sellerId: string) =>
      listSellerMetadataRecords(container().resolve(SELLER_EXTENSION_MODULE), { seller_id: sellerId })
    const playbookOf = async (sellerId: string) =>
      container().resolve(PLAYBOOK_MODULE).listPlaybookAssignments({ seller_id: sellerId })
    const pg = () => container().resolve(ContainerRegistrationKeys.PG_CONNECTION)

    afterEach(() => {
      jest.restoreAllMocks()
    })

    describe("approval", () => {
      it("an application under another store's name links nothing, changes nothing, and stays pending", async () => {
        const victim = await login("victim")
        const store = await storeFor(victim, `Victim Farm ${uid()}`)
        const metadataBefore = await metadataOf(store.id)
        const applicant = await login("applicant")
        const filed = await application(applicant, store.name)
        const mail = stubMail()

        const refused = await approve(filed.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toContain(
          `The store name "${store.name}" gives the web address "${store.handle}", which another store already uses, so this application cannot be approved.`
        )

        expect(await requestStatus(filed.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBeUndefined()
        expect(await metadataOf(store.id)).toEqual(metadataBefore)
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
      it("an applicant invited into another store after filing is refused: nothing created, relinked, written or mailed", async () => {
        // The re-review's probe: Mercur's setAuthAppMetadataStep refuses a linked
        // login with "Key seller_id already exists in app metadata", which once
        // passed for a name clash and resumed approval onto the owner's store.
        const owner = await login("owner")
        const ownerStore = await storeFor(owner, `Owner Farm ${uid()}`)
        const applicant = await login("applicant")
        const storeName = `Applicant Farm ${uid()}`
        jest.spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications").mockResolvedValue([] as any)
        const filed = await file(applicant, storeName)
        expect(filed.status).toBe(201)
        jest.restoreAllMocks()

        const member = await acceptInvite(applicant, ownerStore)
        const metadataBefore = await metadataOf(ownerStore.id)
        const mail = stubMail()

        const refused = await approve(filed.data.request.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/already has a store/)
        expect(await requestStatus(filed.data.request.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBe(member.id)
        expect(await sellersWithHandle(storeName)).toHaveLength(0)
        expect(await metadataOf(ownerStore.id)).toEqual(metadataBefore)
        expect(mail).not.toHaveBeenCalled()
      })

      it("an applicant invited into a store that has her application's name is refused too", async () => {
        // The store's handle matches, but it is not one an approval of hers
        // made: its owner member is someone else, and hers is the invite's.
        const owner = await login("owner")
        const ownerStore = await storeFor(owner, `Same Farm ${uid()}`)
        const applicant = await login("applicant")
        const filed = await application(applicant, ownerStore.name)
        const member = await acceptInvite(applicant, ownerStore)
        const metadataBefore = await metadataOf(ownerStore.id)
        const mail = stubMail()

        const refused = await approve(filed.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/already has a store/)
        expect(await requestStatus(filed.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBe(member.id)
        expect(await metadataOf(ownerStore.id)).toEqual(metadataBefore)
        expect(mail).not.toHaveBeenCalled()
      })

      it("an applicant invited as owner into a store that has since taken her application's name is refused: nothing linked or written", async () => {
        // The follow-up review's probe. She files "Sunny Farm" while no store
        // has the name; another store takes it; she is invited into that store
        // as owner (Mercur's invite takes role "owner" from anyone). The handle
        // matches and an owner with her address is the member her login names,
        // which is all resuming used to ask: approved, relinked onto that
        // store, and its metadata written from her answers.
        const applicant = await login("applicant")
        const storeName = `Sunny Farm ${uid()}`
        stubMail()
        const filed = await file(applicant, storeName)
        expect(filed.status).toBe(201)
        jest.restoreAllMocks()

        const owner = await login("owner")
        const ownerStore = await storeFor(owner, storeName)
        const member = await acceptInvite(applicant, ownerStore, "owner")
        const metadataBefore = await metadataOf(ownerStore.id)
        const mail = stubMail()

        const refused = await approve(filed.data.request.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/already has a store/)
        expect(await requestStatus(filed.data.request.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBe(member.id)
        expect(await metadataOf(ownerStore.id)).toEqual(metadataBefore)
        expect(await playbookOf(ownerStore.id)).toEqual([])
        expect(await sellersWithHandle(storeName)).toEqual([expect.objectContaining({ id: ownerStore.id, name: storeName })])
        expect(mail).not.toHaveBeenCalled()
      })

      it("a retried approval resumes onto the store whose seller id the login holds", async () => {
        // What an approval leaves when it links the seller id and a later step fails.
        const applicant = await login("applicant")
        const store = await storeFor(applicant, `Linked Farm ${uid()}`)
        await container()
          .resolve(Modules.AUTH)
          .updateAuthIdentities([{ id: applicant.authIdentityId, app_metadata: { seller_id: store.id } }])
        const filed = await application(applicant, store.name)
        stubMail()

        const approved = await approve(filed.id)
        expect(approved.status).toBe(200)
        expect(approved.data.seller.id).toBe(store.id)
        expect(await requestStatus(filed.id)).toBe("accepted")
        expect(await linkedSeller(applicant.authIdentityId)).toBe(store.id)
      })

      it("an application under the name of the store another approved application made is refused: that store is finished", async () => {
        // Same login, same name: the store's first member is hers, but an
        // approval already finished it, and resuming would rerun the metadata,
        // playbook and node-operator steps over it with this row's answers.
        const applicant = await login("applicant")
        const store = await storeFor(applicant, `Done Farm ${uid()}`)
        await container()
          .resolve(Modules.AUTH)
          .updateAuthIdentities([{ id: applicant.authIdentityId, app_metadata: { seller_id: store.id } }])
        await application(applicant, store.name, { status: "accepted" })
        const second = await application(applicant, store.name)
        const metadataBefore = await metadataOf(store.id)
        const mail = stubMail()

        const refused = await approve(second.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/already has a store/)
        expect(await requestStatus(second.id)).toBe("pending")
        expect(await linkedSeller(applicant.authIdentityId)).toBe(store.id)
        expect(await metadataOf(store.id)).toEqual(metadataBefore)
        expect(await playbookOf(store.id)).toEqual([])
        expect(mail).not.toHaveBeenCalled()
      })

      it("a login linked to a store that was closed is told so, at approval and at filing", async () => {
        const applicant = await login("applicant")
        const closed = await storeFor(applicant, `Closed Farm ${uid()}`)
        await container().resolve(SELLER_MODULE).softDeleteSellers([closed.id])
        const filed = await application(applicant, `Next Farm ${uid()}`)

        const refused = await approve(filed.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/linked to a store that was closed/)
        expect(await requestStatus(filed.id)).toBe("pending")

        const refiled = await file(applicant, `Other Farm ${uid()}`)
        expect(refiled.status).toBe(409)
        expect(refiled.data.message).toMatch(/linked to a store that was closed/)
      })

      it("a member removed from a store that is still open files, is approved onto a store of its own, and its login names that store", async () => {
        // Mercur's deleteMemberStep soft-deletes the member and leaves the
        // login's link naming it. Filing and approval used to call that "a
        // store that was closed" while the store was live, and the status
        // check called it approved for that store, so the vendor panel's
        // sign-up skipped filing altogether.
        const owner = await login("owner")
        const liveStore = await storeFor(owner, `Live Farm ${uid()}`)
        const removed = await login("removed")
        const member = await acceptInvite(removed, liveStore)
        await deleteMemberWorkflow.run({ container: container(), input: member.id })
        const { rows: memberRows } = await pg().raw(`SELECT deleted_at FROM member WHERE id = ?`, [member.id])
        expect(memberRows[0].deleted_at).not.toBeNull()
        expect(await linkedSeller(removed.authIdentityId)).toBe(member.id)
        const metadataBefore = await metadataOf(liveStore.id)
        const token = memberToken(removed, member.id)

        expect(await registrationStatus(token)).toMatchObject({ status: "no_request" })

        stubMail()
        const storeName = `Own Farm ${uid()}`
        const filed = await file(removed, storeName, token)
        expect(filed.status).toBe(201)
        expect(await registrationStatus(token)).toMatchObject({ status: "pending", request_id: filed.data.request.id })

        const approved = await approve(filed.data.request.id)
        expect(approved.status).toBe(200)
        const ownStore = approved.data.seller
        expect(ownStore).toMatchObject({ name: storeName, handle: toHandle(storeName) })
        expect(ownStore.id).not.toBe(liveStore.id)
        expect(await requestStatus(filed.data.request.id)).toBe("accepted")
        expect(await linkedSeller(removed.authIdentityId)).toBe(ownStore.id)
        expect(await registrationStatus(token)).toMatchObject({ status: "approved", seller_id: ownStore.id })

        // The store it was removed from is as it was.
        expect(await sellersWithHandle(liveStore.name)).toEqual([expect.objectContaining({ id: liveStore.id })])
        expect(await metadataOf(liveStore.id)).toEqual(metadataBefore)
      })

      it("a removed member whose login holds the store's seller id files, and is approved onto a store of its own", async () => {
        // A seller id acts only as the live member of that store at the
        // login's address; with that member removed it names no store of
        // this login's, like a removed member's id. The old seller-auth
        // backfill wrote seller ids for invited members.
        const owner = await login("owner")
        const liveStore = await storeFor(owner, `Kept Farm ${uid()}`)
        const removed = await login("removed")
        const member = await acceptInvite(removed, liveStore)
        await container().resolve(Modules.AUTH).updateAuthIdentities([{ id: removed.authIdentityId, app_metadata: { seller_id: liveStore.id } }])
        await deleteMemberWorkflow.run({ container: container(), input: member.id })

        stubMail()
        const storeName = `Fresh Start Farm ${uid()}`
        const filed = await file(removed, storeName)
        expect(filed.status).toBe(201)

        const approved = await approve(filed.data.request.id)
        expect(approved.status).toBe(200)
        expect(approved.data.seller).toMatchObject({ name: storeName })
        expect(approved.data.seller.id).not.toBe(liveStore.id)
        expect(await linkedSeller(removed.authIdentityId)).toBe(approved.data.seller.id)
      })

      it("a member removed from a store that was then closed is still told the store was closed", async () => {
        const owner = await login("owner")
        const store = await storeFor(owner, `Shut Farm ${uid()}`)
        const removed = await login("removed")
        const member = await acceptInvite(removed, store)
        await deleteMemberWorkflow.run({ container: container(), input: member.id })
        await container().resolve(SELLER_MODULE).softDeleteSellers([store.id])
        const filed = await application(removed, `Next Farm ${uid()}`)

        const refused = await approve(filed.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/linked to a store that was closed/)
        expect(await requestStatus(filed.id)).toBe("pending")
        expect(await linkedSeller(removed.authIdentityId)).toBe(member.id)

        const refiled = await file(removed, `Other Farm ${uid()}`)
        expect(refiled.status).toBe(409)
        expect(refiled.data.message).toMatch(/linked to a store that was closed/)
      })

      it("the status check never relinks a login to a store through a membership that was removed", async () => {
        // registration-status relinks a login whose latest application was
        // approved, and whose link names no live store, to the store of the
        // newest member row with its address. A removed member's row is not
        // one: it would hand the login a seller-id link to the store it was
        // removed from.
        const owner = await login("owner")
        const store = await storeFor(owner, `Former Farm ${uid()}`)
        const removed = await login("removed")
        const member = await acceptInvite(removed, store)
        await deleteMemberWorkflow.run({ container: container(), input: member.id })
        await application(removed, `Approved Farm ${uid()}`, { status: "accepted" })

        const status = await registrationStatus(memberToken(removed, member.id))
        expect(status.status).toBe("approved")
        expect(status.seller_id).toBeUndefined()
        expect(await linkedSeller(removed.authIdentityId)).toBe(member.id)
      })

      it("a store name with no Latin letter or digit is refused at approval, and nothing is created", async () => {
        // Rows filed before the filing check. The first used to be approved
        // with handle "-", the second refused as a clash with it, and the
        // third approved with handle "".
        for (const storeName of ["Ферма Один", "Ферма Два", "日本の農場"]) {
          const applicant = await login("applicant")
          const filed = await application(applicant, storeName)
          const mail = stubMail()

          const refused = await approve(filed.id)
          expect({ storeName, status: refused.status }).toEqual({ storeName, status: 400 })
          expect(refused.data).toMatchObject({ type: "invalid_data" })
          expect(refused.data.message).toContain(STORE_NAME_NEEDS_LATIN)
          expect(refused.data.message).toMatch(/Nothing was created or linked/)
          expect(await requestStatus(filed.id)).toBe("pending")
          expect(await linkedSeller(applicant.authIdentityId)).toBeUndefined()
          expect(mail).not.toHaveBeenCalled()
          jest.restoreAllMocks()
        }
        const { rows } = await pg().raw(`SELECT handle FROM seller WHERE handle IN ('-', '')`)
        expect(rows).toEqual([])
      })

      it("after a name clash, the application is rejected and the applicant files again under another name", async () => {
        const owner = await login("owner")
        const ownerStore = await storeFor(owner, `Taken Farm ${uid()}`)
        const applicant = await login("applicant")
        const filed = await application(applicant, ownerStore.name)

        const refused = await approve(filed.id)
        expect(refused.status).toBe(409)
        expect(refused.data.message).toMatch(/Reject it, then ask the applicant to apply again with another store name/)

        // While it is pending, filing again answers with it: the new name is not taken up.
        const tooSoon = await file(applicant, `Fresh Farm ${uid()}`)
        expect(tooSoon.status).toBe(200)
        expect(tooSoon.data.request.id).toBe(filed.id)

        const rejected = await call(
          api.post(`/admin/requests/${filed.id}/reject`, { reason: "Store name taken" }, bearer(await adminToken()))
        )
        expect(rejected.status).toBe(200)
        expect(await requestStatus(filed.id)).toBe("rejected")

        stubMail()
        const freshName = `Fresh Farm ${uid()}`
        const refiled = await file(applicant, freshName)
        expect(refiled.status).toBe(201)
        const [fresh] = await container().resolve(REQUEST_MODULE).listRequests({ id: refiled.data.request.id })
        expect(fresh).toMatchObject({ status: "pending", submitter_id: applicant.authIdentityId })
        expect(fresh.data.seller.name).toBe(freshName)
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
        expect(refused.data.message).toBe(
          `The store name "${store.name.toUpperCase()}!" gives the web address "${store.handle}", which another store already uses. Choose another store name.`
        )
        expect(await container().resolve(REQUEST_MODULE).listRequests({})).toHaveLength(0)
      })

      it("two names that share a web address: the second is told the address is taken, not that a store has its name", async () => {
        // «Ферма 1» and «Магазин 1» both make the handle "-1". The second used
        // to be told "A store named «Магазин 1» already exists".
        const owner = await login("owner")
        const store = await storeFor(owner, "Ферма 1")
        expect(store.handle).toBe("-1")
        const mail = stubMail()

        const applicant = await login("applicant")
        const refused = await file(applicant, "Магазин 1")
        expect(refused.status).toBe(409)
        expect(refused.data).toEqual({
          type: "conflict",
          message: 'The store name "Магазин 1" gives the web address "-1", which another store already uses. Choose another store name.',
        })

        // A row filed before «Ферма 1» took the address.
        const earlier = await login("earlier")
        const row = await application(earlier, "Магазин 1")
        const notApproved = await approve(row.id)
        expect(notApproved.status).toBe(409)
        expect(notApproved.data.message).toBe(
          'The store name "Магазин 1" gives the web address "-1", which another store already uses, so this application cannot be approved. Nothing was created or linked. Reject it, then ask the applicant to apply again with another store name.'
        )
        expect(await requestStatus(row.id)).toBe("pending")
        expect(await linkedSeller(earlier.authIdentityId)).toBeUndefined()
        expect(mail).not.toHaveBeenCalled()
      })

      it("a store name with no Latin letter or digit is refused with a message that says why, and nothing is filed", async () => {
        const mail = stubMail()
        for (const storeName of ["Ферма Один", "Ферма Два", "日本の農場"]) {
          const applicant = await login("applicant")
          const refused = await file(applicant, storeName)
          expect({ storeName, status: refused.status }).toEqual({ storeName, status: 400 })
          expect(refused.data).toEqual({ type: "invalid_data", message: STORE_NAME_NEEDS_LATIN })
        }
        expect(await container().resolve(REQUEST_MODULE).listRequests({})).toHaveLength(0)
        expect(mail).not.toHaveBeenCalled()
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
