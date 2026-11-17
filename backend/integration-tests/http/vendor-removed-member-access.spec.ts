import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow, deleteMemberWorkflow } from "@mercurjs/b2c-core/workflows"
import { PLAYBOOK_MODULE } from "../../src/modules/playbook"
import { REQUEST_MODULE } from "../../src/modules/request"
import backfillSellerAuth from "../../src/scripts/backfill-seller-auth"
import seedPlaybooks from "../../src/scripts/seed-playbooks"
import {
  liveSellerIdForActor,
  resolveSellerActor,
  sellerIdForVendorActor,
} from "../../src/shared/seller-actor"
import { REFUSED_SELLER_ID_LINKS_SQL } from "../../src/shared/seller-auth-backfill"
import { requireSellerId } from "../../src/shared/auth-helpers"
import { createAuthenticatedSeller } from "./helpers/seller-auth"
import { newTestPassword } from "./helpers/test-password"

jest.setTimeout(240 * 1000)

/**
 * A member removed from a store, or a member of a store that was closed, acts
 * for no store (SD-NEW-removed-member-access), on the real server and a real
 * migrated database.
 *
 * Mercur's deleteMemberStep soft-deletes a removed member and leaves the
 * login's `app_metadata.seller_id` naming it, and signing in mints that
 * member as the actor again. The vendor gate resolved members without
 * `deleted_at`, and Mercur's guards do not stop it: storeActiveGuard lets
 * every GET through, and fetchSellerByAuthActorId's `members.id` filter
 * matches soft-deleted rows. Measured before the fix, a removed member's old
 * and fresh tokens got 200 from every read below, including the order list
 * with the customer's address, and POST /vendor/playbook/assign changed the
 * store's playbook. `/v1/seller/**` took any member row and any `sel_` id, so
 * a member of a closed store still got 200 there.
 *
 * The seller-auth backfill (POST /admin/backfill-seller-auth and its script)
 * links an unlinked login to its member, as Mercur does, never through a
 * removed member or to a closed store. It wrote the seller id, which acts as
 * the store's owner, and matched removed members: after approval cleared a
 * removed member's link and then failed on a name clash, it handed the store
 * back as its owner (follow-up review, measured on Postgres).
 *
 * A login linked by seller id (what approval writes, and what the backfill
 * used to write for any member) acts only as the live member of that store at
 * the login's own address. It acted as the store's first live member, its
 * owner, whoever held it: an invited member given the seller id acted as the
 * owner, and kept every read after being removed (follow-up review, P1).
 *
 * Members are removed with Mercur's own deleteMemberWorkflow. Spends 14 of the
 * auth limiter's 20 a minute (seller register and real sign-ins; the other
 * tokens carry the claims Medusa mints).
 */

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)
    const ADDRESS = "12 Secret Lane"

    /** A login linked to a new member row of the store, as an accepted invite leaves one. */
    async function teamMember(store: { id: string }, prefix: string) {
      const email = `${prefix}-${uid()}@example.com`
      const password = newTestPassword("member")
      const auth = container().resolve(Modules.AUTH)
      await auth.register("emailpass", { body: { email, password } } as any)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      const [member] = await container()
        .resolve(SELLER_MODULE)
        .createMembers([{ seller_id: store.id, name: prefix, email, role: "member" }])
      await auth.updateAuthIdentities([{ id: provider.auth_identity_id, app_metadata: { seller_id: member.id } }])
      return { email, password, memberId: member.id as string, authIdentityId: provider.auth_identity_id as string }
    }

    /** What the vendor panel's sign-in hands back: Medusa mints the linked member as the actor. */
    async function signIn(who: { email: string; password: string }) {
      const res = await api.post("/auth/seller/emailpass", { email: who.email, password: who.password })
      return res.data.token as string
    }

    /** A store with a product, and an order shipped to a customer's address. */
    async function storeWithData() {
      const owner = await createAuthenticatedSeller({ api, getContainer })
      const store = owner.seller
      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([{ title: `Jam ${uid()}`, handle: `jam-${uid()}`, status: "published" }])
      await link().create({ [SELLER_MODULE]: { seller_id: store.id }, [Modules.PRODUCT]: { product_id: product.id } })
      const [order] = await container()
        .resolve(Modules.ORDER)
        .createOrders([
          {
            currency_code: "usd",
            email: "buyer@example.com",
            customer_id: `cus_${uid()}`,
            shipping_address: { first_name: "Ada", last_name: "Lovelace", address_1: ADDRESS, city: "Detroit", postal_code: "48201", country_code: "us" },
            items: [{ title: "Jam", product_id: product.id, quantity: 1, unit_price: 10 }],
          },
        ])
      await link().create({ [SELLER_MODULE]: { seller_id: store.id }, [Modules.ORDER]: { order_id: order.id } })
      return { owner, store, product: product as { id: string }, order: order as { id: string } }
    }

    const readsOf = (orderId: string) => [
      "/vendor/sellers/me",
      "/vendor/orders",
      `/vendor/orders/${orderId}`,
      "/vendor/products",
      "/vendor/members",
      "/vendor/me",
      "/v1/seller/plugins/installed",
    ]
    const playbookOf = async (sellerId: string) =>
      container().resolve(PLAYBOOK_MODULE).listPlaybookAssignments({ seller_id: sellerId })
    const linkOf = async (authIdentityId: string) =>
      ((await container().resolve(Modules.AUTH).listAuthIdentities({ id: [authIdentityId] }))[0]?.app_metadata ?? {}).seller_id

    /** A login made through the auth module, so it spends none of the limiter. */
    async function plainLogin(prefix: string) {
      const email = `${prefix}-${uid()}@example.com`
      const password = newTestPassword("login")
      const auth = container().resolve(Modules.AUTH)
      await auth.register("emailpass", { body: { email, password } } as any)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      return { email, password, authIdentityId: provider.auth_identity_id as string }
    }

    /** A store made the way approval makes one: Mercur links its owner's login to the owner member. */
    async function storeOf(name: string) {
      const owner = await plainLogin("owner")
      const { result: store } = await createSellerWorkflow.run({
        container: container(),
        input: { auth_identity_id: owner.authIdentityId, member: { name: "Owner", email: owner.email }, seller: { name } } as any,
      })
      const [ownerMember] = await container().resolve(SELLER_MODULE).listMembers({ seller_id: store.id })
      return { owner, ownerMemberId: ownerMember.id as string, store: store as { id: string; name: string; handle: string } }
    }

    /** A member row with no login linked to it: what the backfill exists for. */
    async function unlinkedMember(store: { id: string }, prefix: string) {
      const login = await plainLogin(prefix)
      const [member] = await container()
        .resolve(SELLER_MODULE)
        .createMembers([{ seller_id: store.id, name: prefix, email: login.email, role: "member" }])
      return { ...login, memberId: member.id as string }
    }

    async function adminToken() {
      const admin = await plainLogin("admin")
      const [user] = await container().resolve(Modules.USER).createUsers([{ email: admin.email }])
      await container().resolve(Modules.AUTH).updateAuthIdentities([{ id: admin.authIdentityId, app_metadata: { user_id: user.id } }])
      return jwt.sign(
        { actor_id: user.id, actor_type: "user", auth_identity_id: admin.authIdentityId, app_metadata: { user_id: user.id } },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      )
    }
    const backfill = async () => call(api.post("/admin/backfill-seller-auth", {}, bearer(await adminToken())))

    /** The claims Medusa mints at sign-in: the login's link as the actor. Spends none of the limiter. */
    const tokenFor = (who: { authIdentityId: string }, actorId: string) =>
      jwt.sign(
        { actor_id: actorId, actor_type: "seller", auth_identity_id: who.authIdentityId, auth_provider: "emailpass", app_metadata: { seller_id: actorId }, user_metadata: {} },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      )
    /** A login with no seller link yet, as POST /auth/seller/emailpass/register hands it back. */
    const registrationTokenFor = (who: { authIdentityId: string }) =>
      jwt.sign(
        { actor_id: "", actor_type: "seller", auth_identity_id: who.authIdentityId, app_metadata: {}, user_metadata: {} },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      )
    /** What approval writes, and what the seller-auth backfill used to write for any member. */
    const linkBySellerId = async (who: { authIdentityId: string }, sellerId: string) =>
      container().resolve(Modules.AUTH).updateAuthIdentities([{ id: who.authIdentityId, app_metadata: { seller_id: sellerId } }])

    afterEach(() => {
      jest.restoreAllMocks()
    })

    describe("a member removed from a store", () => {
      it("is refused on every route, with a token from before the removal and with a fresh sign-in", async () => {
        await seedPlaybooks({ container: container(), args: [] } as any)
        const { store, order } = await storeWithData()
        const removed = await teamMember(store, "removed")
        const before = await signIn(removed)
        await deleteMemberWorkflow.run({ container: container(), input: removed.memberId })
        const after = await signIn(removed)
        // Signing in still works, and still names the removed member.
        expect(jwt.decode(after)).toMatchObject({ actor_type: "seller", actor_id: removed.memberId })

        for (const [token, which] of [[before, "before removal"], [after, "fresh sign-in"]] as const) {
          for (const path of readsOf(order.id)) {
            const res = await call(api.get(path, bearer(token)))
            expect({ which, path, status: res.status }).toEqual({ which, path, status: 401 })
            const body = JSON.stringify(res.data ?? {})
            expect({ which, path, leaks: body.includes(ADDRESS) || body.includes(store.id) }).toEqual({ which, path, leaks: false })
          }

          const assigned = await call(api.post("/vendor/playbook/assign", { recipe_id: "stall" }, bearer(token)))
          expect({ which, status: assigned.status }).toEqual({ which, status: 401 })
          const created = await call(api.post("/vendor/products", { title: `Not Mine ${uid()}`, status: "draft" }, bearer(token)))
          expect({ which, status: created.status }).toEqual({ which, status: 401 })
          const installed = await call(api.post("/v1/seller/plugins/sales-analytics/install", {}, bearer(token)))
          expect({ which, status: installed.status }).toEqual({ which, status: 401 })
        }
        expect(await playbookOf(store.id)).toEqual([])
      })
    })

    describe("the owner and a member still on the team", () => {
      it("still read and write on the same routes", async () => {
        await seedPlaybooks({ container: container(), args: [] } as any)
        const { owner, store, order } = await storeWithData()
        const active = await teamMember(store, "active")
        const activeToken = await signIn(active)

        for (const [token, who] of [[owner.token, "owner"], [activeToken, "member"]] as const) {
          for (const path of readsOf(order.id)) {
            const res = await call(api.get(path, bearer(token)))
            expect({ who, path, status: res.status }).toEqual({ who, path, status: 200 })
          }
          const orders = await api.get("/vendor/orders", bearer(token))
          expect(orders.data.orders.map((o: { id: string }) => o.id)).toEqual([order.id])
          const detail = await api.get(`/vendor/orders/${order.id}`, bearer(token))
          expect(JSON.stringify(detail.data)).toContain(ADDRESS)
          const me = await api.get("/vendor/sellers/me", bearer(token))
          expect(me.data.seller.id).toBe(store.id)
          // Past the gate, the install route itself answers.
          const installed = await call(api.post("/v1/seller/plugins/no-such-plugin/install", {}, bearer(token)))
          expect({ who, status: installed.status }).toEqual({ who, status: 404 })
        }

        const assigned = await call(api.post("/vendor/playbook/assign", { recipe_id: "stall" }, bearer(activeToken)))
        expect(assigned.status).toBe(200)
        expect((await playbookOf(store.id)).map((a: { recipe_id: string }) => a.recipe_id)).toEqual(["stall"])
      })
    })

    describe("a store that was closed", () => {
      it("refuses its members, and a login linked to it by seller id, on every route", async () => {
        await seedPlaybooks({ container: container(), args: [] } as any)
        const auth = container().resolve(Modules.AUTH)
        const ownerEmail = `closed-owner-${uid()}@example.com`
        const ownerPassword = newTestPassword("closed")
        await auth.register("emailpass", { body: { email: ownerEmail, password: ownerPassword } } as any)
        const [ownerProvider] = await auth.listProviderIdentities({ entity_id: ownerEmail, provider: "emailpass" })
        const { result: store } = await createSellerWorkflow.run({
          container: container(),
          input: { auth_identity_id: ownerProvider.auth_identity_id, member: { name: "Owner", email: ownerEmail }, seller: { name: `Closed Farm ${uid()}` } } as any,
        })
        // What a finished approval leaves: the login linked by seller id.
        await auth.updateAuthIdentities([{ id: ownerProvider.auth_identity_id, app_metadata: { seller_id: store.id } }])
        const ownerToken = await signIn({ email: ownerEmail, password: ownerPassword })
        expect(jwt.decode(ownerToken)).toMatchObject({ actor_id: store.id })
        const member = await teamMember(store, "member")
        const memberToken = await signIn(member)
        await container().resolve(SELLER_MODULE).softDeleteSellers([store.id])

        for (const [token, who] of [[ownerToken, "seller-id link"], [memberToken, "member"]] as const) {
          for (const path of readsOf("order_none")) {
            const res = await call(api.get(path, bearer(token)))
            expect({ who, path, status: res.status }).toEqual({ who, path, status: 401 })
          }
          // Mercur's storeActiveGuard, which runs first on this route, refuses
          // a write for a store it cannot find; the gate refuses everything else.
          const assigned = await call(api.post("/vendor/playbook/assign", { recipe_id: "stall" }, bearer(token)))
          expect({ who, status: assigned.status }).toEqual({ who, status: 403 })
          const installed = await call(api.post("/v1/seller/plugins/sales-analytics/install", {}, bearer(token)))
          expect({ who, status: installed.status }).toEqual({ who, status: 401 })
        }
        expect(await playbookOf(store.id)).toEqual([])
      })
    })

    describe("the seller-auth backfill", () => {
      it("links an invited member's login to that member, and the login then acts as it, not as the owner", async () => {
        const { owner, ownerMemberId, store } = await storeOf(`Backfill Farm ${uid()}`)
        const invited = await unlinkedMember(store, "invited")

        const res = await backfill()
        expect(res.status).toBe(200)
        expect(res.data.summary).toMatchObject({ updated: 1, errors: 0 })

        // Who the login acts as, first: a seller-id link would make it the owner.
        const token = await signIn(invited)
        const me = await api.get("/vendor/me", bearer(token))
        expect(me.data.member).toMatchObject({ id: invited.memberId, role: "member", seller_id: store.id })
        expect(me.data.member.id).not.toBe(ownerMemberId)
        const profile = await api.get("/vendor/sellers/me", bearer(token))
        expect(profile.data.seller.id).toBe(store.id)
        expect(jwt.decode(token)).toMatchObject({ actor_id: invited.memberId })
        expect(await linkOf(invited.authIdentityId)).toBe(invited.memberId)
        expect(await linkOf(owner.authIdentityId)).toBe(ownerMemberId)
      })

      it("does not hand a removed member its old store back after approval cleared its link and then failed", async () => {
        // The follow-up review's sequence: a removed member files; approval
        // clears the stale link, then fails on a name clash; the backfill used
        // to write the old store's seller id onto the now unlinked login, and
        // /vendor/me gave the owner's member.
        const { store } = await storeOf(`Old Farm ${uid()}`)
        const removed = await teamMember(store, "removed")
        await deleteMemberWorkflow.run({ container: container(), input: removed.memberId })
        const { store: taken } = await storeOf(`Taken Farm ${uid()}`)
        const [row] = await container().resolve(REQUEST_MODULE).createRequests([
          {
            type: "seller",
            status: "pending",
            submitter_id: removed.authIdentityId,
            data: { auth_identity_id: removed.authIdentityId, member: { name: "Removed", email: removed.email }, seller: { name: taken.name }, vendor_type: "general" },
          },
        ])
        jest.spyOn(container().resolve(Modules.NOTIFICATION), "createNotifications").mockResolvedValue([] as any)

        const refused = await call(api.post(`/admin/requests/${row.id}/approve`, {}, bearer(await adminToken())))
        expect(refused.status).toBe(409)
        expect(refused.data.message).toContain(`gives the web address "${taken.handle}", which another store already uses`)
        expect(await linkOf(removed.authIdentityId)).toBeUndefined()

        const res = await backfill()
        expect(res.status).toBe(200)
        expect(await linkOf(removed.authIdentityId)).toBeUndefined()

        const token = await signIn(removed)
        const me = await call(api.get("/vendor/me", bearer(token)))
        expect(me.status).toBe(403)
        expect(JSON.stringify(me.data)).not.toContain(store.id)
      })

      it("the script links the same way, and skips removed members and closed stores", async () => {
        const { store } = await storeOf(`Script Farm ${uid()}`)
        const invited = await unlinkedMember(store, "invited")
        const removed = await unlinkedMember(store, "removed")
        await deleteMemberWorkflow.run({ container: container(), input: removed.memberId })
        const { store: closed } = await storeOf(`Shut Farm ${uid()}`)
        const closedMember = await unlinkedMember(closed, "closedmember")
        await container().resolve(SELLER_MODULE).softDeleteSellers([closed.id])
        jest.spyOn(console, "log").mockImplementation(() => undefined)

        await backfillSellerAuth({ container: container(), args: [] } as any)

        expect(await linkOf(invited.authIdentityId)).toBe(invited.memberId)
        expect(await linkOf(removed.authIdentityId)).toBeUndefined()
        expect(await linkOf(closedMember.authIdentityId)).toBeUndefined()
      })
    })

    describe("a login linked by seller id", () => {
      it("a removed member whose login holds the store's seller id is refused, before and after signing in again", async () => {
        // The follow-up review's P1. The old backfill gave invited members
        // the seller id, which acted as the store's first member, its owner,
        // and kept doing so after deleteMemberWorkflow removed the member.
        await seedPlaybooks({ container: container(), args: [] } as any)
        const { store, order } = await storeWithData()
        const member = await teamMember(store, "invited")
        await linkBySellerId(member, store.id)
        const before = await signIn(member)
        expect(jwt.decode(before)).toMatchObject({ actor_id: store.id })
        // While on the team, it acts as itself.
        const asItself = await api.get("/vendor/me", bearer(before))
        expect(asItself.data.member).toMatchObject({ id: member.memberId, role: "member" })

        await deleteMemberWorkflow.run({ container: container(), input: member.memberId })
        const after = await signIn(member)
        expect(jwt.decode(after)).toMatchObject({ actor_id: store.id })

        for (const [token, which] of [[before, "before removal"], [after, "fresh sign-in"]] as const) {
          for (const path of readsOf(order.id)) {
            const res = await call(api.get(path, bearer(token)))
            expect({ which, path, status: res.status }).toEqual({ which, path, status: 401 })
            const body = JSON.stringify(res.data ?? {})
            expect({ which, path, leaks: body.includes(ADDRESS) || body.includes(store.id) }).toEqual({ which, path, leaks: false })
          }
          const assigned = await call(api.post("/vendor/playbook/assign", { recipe_id: "stall" }, bearer(token)))
          expect({ which, status: assigned.status }).toEqual({ which, status: 401 })
          const installed = await call(api.post("/v1/seller/plugins/sales-analytics/install", {}, bearer(token)))
          expect({ which, status: installed.status }).toEqual({ which, status: 401 })
        }
        expect(await playbookOf(store.id)).toEqual([])
      })

      it("an owner whose own member row is gone acts as nobody, not as the store's next member", async () => {
        // The review's P2: Mercur will not delete an owner, so the row is
        // soft-deleted directly. The owner's seller id then acted as the
        // second member, and /vendor/me returned that member's record.
        const { owner, ownerMemberId, store } = await storeOf(`Gone Owner Farm ${uid()}`)
        await linkBySellerId(owner, store.id)
        const second = await teamMember(store, "second")
        await container().resolve(SELLER_MODULE).softDeleteMembers([ownerMemberId])
        const token = tokenFor(owner, store.id)

        for (const path of ["/vendor/me", "/vendor/sellers/me", "/vendor/members", "/v1/seller/plugins/installed"]) {
          const res = await call(api.get(path, bearer(token)))
          expect({ path, status: res.status }).toEqual({ path, status: 401 })
          expect({ path, leaks: JSON.stringify(res.data ?? {}).includes(second.email) }).toEqual({ path, leaks: false })
        }
      })

      it("an owner linked by seller id, as approval links one, still acts as the owner", async () => {
        const { owner, ownerMemberId, store } = await storeOf(`Approved Farm ${uid()}`)
        await linkBySellerId(owner, store.id)
        await teamMember(store, "colleague")
        const token = tokenFor(owner, store.id)

        const me = await api.get("/vendor/me", bearer(token))
        expect(me.data.member).toMatchObject({ id: ownerMemberId, role: "owner", seller_id: store.id })
        expect((await api.get("/vendor/sellers/me", bearer(token))).data.seller.id).toBe(store.id)
        expect((await api.get("/vendor/members", bearer(token))).data.members).toHaveLength(2)
        expect((await call(api.get("/v1/seller/plugins/installed", bearer(token)))).status).toBe(200)
      })

      it("an invited member linked by seller id acts as itself, not as the owner", async () => {
        const { ownerMemberId, store } = await storeOf(`Invited Farm ${uid()}`)
        const invited = await teamMember(store, "invited")
        await linkBySellerId(invited, store.id)

        const me = await api.get("/vendor/me", bearer(tokenFor(invited, store.id)))
        expect(me.data.member).toMatchObject({ id: invited.memberId, role: "member", seller_id: store.id })
        expect(me.data.member.id).not.toBe(ownerMemberId)
      })

      it("matches the login's address to a member's email ignoring case and surrounding spaces", async () => {
        const { store } = await storeOf(`Case Farm ${uid()}`)
        const login = await plainLogin("mixed")
        const [member] = await container()
          .resolve(SELLER_MODULE)
          .createMembers([{ seller_id: store.id, name: "Mixed", email: `  ${login.email.toUpperCase()} `, role: "member" }])
        await linkBySellerId(login, store.id)

        const me = await api.get("/vendor/me", bearer(tokenFor(login, store.id)))
        expect(me.data.member.id).toBe(member.id)
      })

      it("of two live members at the login's address, acts as the one made first", async () => {
        const { store } = await storeOf(`Twice Farm ${uid()}`)
        const login = await plainLogin("twice")
        const sellers = container().resolve(SELLER_MODULE)
        const [first] = await sellers.createMembers([{ seller_id: store.id, name: "First", email: login.email, role: "member" }])
        const [later] = await sellers.createMembers([{ seller_id: store.id, name: "Later", email: login.email, role: "admin" }])
        await linkBySellerId(login, store.id)

        const me = await api.get("/vendor/me", bearer(tokenFor(login, store.id)))
        expect(me.data.member.id).toBe(first.id)
        expect(me.data.member.id).not.toBe(later.id)
      })

      it("registration-status relinks an approved login to its member, which then acts with its own role", async () => {
        const { ownerMemberId, store } = await storeOf(`Relink Farm ${uid()}`)
        const login = await plainLogin("approved")
        const [member] = await container()
          .resolve(SELLER_MODULE)
          .createMembers([{ seller_id: store.id, name: "Approved", email: login.email, role: "member" }])
        await container().resolve(REQUEST_MODULE).createRequests([
          {
            type: "seller",
            status: "accepted",
            submitter_id: login.authIdentityId,
            data: { auth_identity_id: login.authIdentityId, member: { name: "Approved", email: login.email }, seller: { name: store.name } },
          },
        ])

        const status = await api.get("/auth/seller/registration-status", bearer(registrationTokenFor(login)))
        expect(status.data).toMatchObject({ status: "approved", seller_id: store.id })
        expect(await linkOf(login.authIdentityId)).toBe(member.id)

        const token = await signIn(login)
        expect(jwt.decode(token)).toMatchObject({ actor_id: member.id })
        const me = await api.get("/vendor/me", bearer(token))
        expect(me.data.member).toMatchObject({ id: member.id, role: "member" })
        expect(me.data.member.id).not.toBe(ownerMemberId)
      })

      it("the backfill's report, and the read-only query, name every seller-id link the gates refuse, and why", async () => {
        const sellers = container().resolve(SELLER_MODULE)
        const { owner, store } = await storeOf(`Audit Farm ${uid()}`)
        await linkBySellerId(owner, store.id)
        const invited = await teamMember(store, "invited")
        await linkBySellerId(invited, store.id)
        // P1's login.
        const removed = await teamMember(store, "removed")
        await linkBySellerId(removed, store.id)
        await deleteMemberWorkflow.run({ container: container(), input: removed.memberId })
        // An owner whose member email no longer matches its login's address: locked out.
        const drifted = await storeOf(`Drifted Farm ${uid()}`)
        await linkBySellerId(drifted.owner, drifted.store.id)
        const changedEmail = `changed-${uid()}@example.com`
        await sellers.updateMembers([{ id: drifted.ownerMemberId, email: changedEmail }])
        // A closed store's seller-id link.
        const shut = await storeOf(`Shut Audit Farm ${uid()}`)
        await linkBySellerId(shut.owner, shut.store.id)
        await sellers.softDeleteSellers([shut.store.id])

        const res = await backfill()
        expect(res.status).toBe(200)
        expect(res.data.summary.refused).toBe(3)
        const refusals = (res.data.details as string[]).filter((line) => line.startsWith("⛔"))
        expect(refusals).toHaveLength(3)
        expect(refusals).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${removed.email} holds ${store.id}, which the gates refuse: removed_member`),
            expect.stringContaining(`${drifted.owner.email} holds ${drifted.store.id}, which the gates refuse: no_member_at_login_address`),
            expect.stringContaining(`${shut.owner.email} holds ${shut.store.id}, which the gates refuse: closed_store`),
          ])
        )
        expect(refusals.find((line) => line.includes(drifted.owner.email))).toContain(`the store's first member is ${changedEmail}`)
        const joined = refusals.join("\n")
        expect(joined).not.toContain(owner.email)
        expect(joined).not.toContain(invited.email)

        // The same query, as the operator runs it before deploying.
        const { rows } = await container().resolve(ContainerRegistrationKeys.PG_CONNECTION).raw(REFUSED_SELLER_ID_LINKS_SQL)
        expect(
          rows.map((r: { auth_identity_id: string; reason: string }) => [r.auth_identity_id, r.reason]).sort()
        ).toEqual(
          [
            [removed.authIdentityId, "removed_member"],
            [drifted.owner.authIdentityId, "no_member_at_login_address"],
            [shut.owner.authIdentityId, "closed_store"],
          ].sort()
        )
      })
    })

    describe("the rule both gates and the routes behind them read (shared/seller-actor.ts)", () => {
      it("a member id acts as itself while it and its store are live; a seller id only as the live member at the login's address", async () => {
        const { owner, ownerMemberId, store } = await storeOf(`Rule Farm ${uid()}`)
        const active = await teamMember(store, "active")
        const removed = await teamMember(store, "removed")
        await deleteMemberWorkflow.run({ container: container(), input: removed.memberId })
        const stranger = await plainLogin("stranger")
        const scope = container()

        expect(await resolveSellerActor(scope, active.memberId, active.authIdentityId)).toEqual({ sellerId: store.id, memberId: active.memberId })
        expect(await resolveSellerActor(scope, removed.memberId, removed.authIdentityId)).toBeNull()
        expect(await resolveSellerActor(scope, store.id, owner.authIdentityId)).toEqual({ sellerId: store.id, memberId: ownerMemberId })
        expect(await resolveSellerActor(scope, store.id, active.authIdentityId)).toEqual({ sellerId: store.id, memberId: active.memberId })
        expect(await resolveSellerActor(scope, store.id, removed.authIdentityId)).toBeNull()
        expect(await resolveSellerActor(scope, store.id, stranger.authIdentityId)).toBeNull()
        expect(await resolveSellerActor(scope, store.id, null)).toBeNull()
        expect(await resolveSellerActor(scope, "cus_not_a_seller", owner.authIdentityId)).toBeNull()

        // Behind the gate, the store it resolved for this request is taken as it is; otherwise the rule applies.
        const routed = { scope, auth_context: { auth_identity_id: stranger.authIdentityId }, _seller_id: store.id, _sellerContextResolved: true }
        expect(await sellerIdForVendorActor(routed, store.id)).toBe(store.id)
        expect(await sellerIdForVendorActor({ ...routed, _sellerContextResolved: false }, store.id)).toBeUndefined()
        expect(await sellerIdForVendorActor({ scope, auth_context: { auth_identity_id: owner.authIdentityId } }, store.id)).toBe(store.id)
        expect(await sellerIdForVendorActor({ scope }, active.memberId)).toBe(store.id)
        expect(await sellerIdForVendorActor({ scope }, removed.memberId)).toBeUndefined()

        // requireSellerId, which most vendor routes call behind the gate, reads the same rule.
        const resStub = () => {
          const res: any = { statusCode: 200 }
          res.status = (code: number) => ((res.statusCode = code), res)
          res.json = (body: unknown) => ((res.body = body), res)
          return res
        }
        const asking = (actorId: string, authIdentityId: string) => ({ auth_context: { actor_id: actorId, auth_identity_id: authIdentityId }, headers: {}, scope })
        const ownerRes = resStub()
        expect(await requireSellerId(asking(store.id, owner.authIdentityId), ownerRes)).toBe(store.id)
        const removedRes = resStub()
        expect(await requireSellerId(asking(store.id, removed.authIdentityId), removedRes)).toBeNull()
        expect(removedRes.statusCode).toBe(401)
        const removedMemberRes = resStub()
        expect(await requireSellerId(asking(removed.memberId, removed.authIdentityId), removedMemberRes)).toBeNull()
        expect(removedMemberRes.statusCode).toBe(401)

        await container().resolve(SELLER_MODULE).softDeleteSellers([store.id])
        expect(await liveSellerIdForActor(scope, active.memberId, active.authIdentityId)).toBeNull()
        expect(await liveSellerIdForActor(scope, store.id, owner.authIdentityId)).toBeNull()
      })
    })
  },
})
