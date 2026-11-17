import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { authenticate } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow, deleteMemberWorkflow } from "@mercurjs/b2c-core/workflows"
import { ensureSellerContext } from "../../src/api/vendor/_middlewares"
import { ACCOUNTS_RECEIVABLE_MODULE } from "../../src/modules/accounts-receivable"
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
import { assignSellerPlan, createAuthenticatedSeller } from "./helpers/seller-auth"
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
 * A seller session cookie sent with a bearer token is refused when the two
 * name different logins, and the gate validates the bearer's actor, which is
 * what every handler after it then sees (follow-up re-review, R-c). Mercur's
 * checkSellerApproved reads only the bearer and accepts any seller token with
 * an actor; Mercur's authenticate prefers the session, so the gate validated
 * the session's actor; a route-level authenticate("seller", "bearer") then put
 * the bearer's back, unvalidated. Measured before the fix: a removed member's
 * bearer with a live seller's cookie read the store's invoices and wrote one,
 * and listed the store's promotions through Mercur's fetchSellerByAuthActorId.
 *
 * Members are removed with Mercur's own deleteMemberWorkflow. Spends 16 of the
 * auth limiter's 20 a minute (seller register, real sign-ins and two sessions;
 * the other tokens carry the claims Medusa mints).
 */

medusaIntegrationTestRunner({
  inApp: true,
  // /vendor/invoices answers 404 with its kill switch off.
  env: { FF_INVOICING_V1: "true" },
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

    /** An order of the store, shipped to a customer's address. */
    async function orderFor(store: { id: string }) {
      const [order] = await container()
        .resolve(Modules.ORDER)
        .createOrders([
          {
            currency_code: "usd",
            email: "buyer@example.com",
            customer_id: `cus_${uid()}`,
            shipping_address: { first_name: "Ada", last_name: "Lovelace", address_1: ADDRESS, city: "Detroit", postal_code: "48201", country_code: "us" },
            items: [{ title: "Jam", quantity: 1, unit_price: 10 }],
          },
        ])
      await link().create({ [SELLER_MODULE]: { seller_id: store.id }, [Modules.ORDER]: { order_id: order.id } })
      return order as { id: string }
    }

    /** A promotion of the store, as Mercur's vendor promotions routes list them. */
    async function promotionFor(store: { id: string }) {
      const code = `SECRET${uid().toUpperCase()}`
      const [promotion] = await container()
        .resolve(Modules.PROMOTION)
        .createPromotions([
          { code, type: "standard", status: "draft", application_method: { type: "percentage", target_type: "order", allocation: "across", value: 10 } },
        ])
      await link().create({ [SELLER_MODULE]: { seller_id: store.id }, [Modules.PROMOTION]: { promotion_id: promotion.id } })
      return { id: promotion.id as string, code }
    }

    /** A session cookie from Medusa's own POST /auth/session for this token. Spends one of the limiter. */
    async function sessionCookie(token: string) {
      const session = await api.post("/auth/session", {}, bearer(token))
      const cookie = (session.headers["set-cookie"] as string[]).map((c) => c.split(";")[0]).join("; ")
      expect(cookie).toMatch(/connect\.sid=/)
      return cookie
    }
    const withSession = (token: string, cookie: string) => ({ headers: { authorization: `Bearer ${token}`, cookie } })
    const invoicesOf = async (memberId: string) =>
      container().resolve(ACCOUNTS_RECEIVABLE_MODULE).listInvoices({ seller_id: memberId })

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

    describe("a seller session cookie sent with a bearer token", () => {
      it("a removed member's bearer with a live seller's cookie is refused on every route, and nothing is written", async () => {
        // The re-review's R-c. The gate validated the session's actor, and a
        // route-level authenticate("seller", "bearer") then handed the
        // handlers the bearer's: the removed member's. Measured before the
        // fix: GET /vendor/invoices 200 with the store's invoice, POST 201
        // under the removed member's id, and Mercur's promotions list (behind
        // /vendor/promotion*) found the store through the removed member.
        const { owner, ownerMemberId, store } = await storeOf(`Session Farm ${uid()}`)
        const order = await orderFor(store)
        const promotion = await promotionFor(store)
        const removed = await teamMember(store, "removed")
        const invoices = container().resolve(ACCOUNTS_RECEIVABLE_MODULE)
        await invoices.createDraft({ sellerId: removed.memberId, customerId: "cus_secret", totalCents: 1500, memo: "S customer invoice" })
        await deleteMemberWorkflow.run({ container: container(), input: removed.memberId })
        // A member of a store that was closed, the same way.
        const shut = await storeOf(`Shut Session Farm ${uid()}`)
        const shutMember = await teamMember(shut.store, "shut")
        await invoices.createDraft({ sellerId: shutMember.memberId, customerId: "cus_shut_secret", totalCents: 900, memo: "closed store invoice" })
        await container().resolve(SELLER_MODULE).softDeleteSellers([shut.store.id])

        const elsewhere = await storeOf(`Elsewhere Farm ${uid()}`)
        // Every store here may invoice, so only the gate can refuse.
        for (const id of [store.id, shut.store.id, elsewhere.store.id]) {
          await assignSellerPlan(container(), id, "internal")
        }
        const cookie = await sessionCookie(tokenFor(elsewhere.owner, elsewhere.ownerMemberId))
        const removedBearer = tokenFor(removed, removed.memberId)

        // Each alone is refused: Mercur's guard needs a bearer, and the gate refuses this one.
        expect((await call(api.get("/vendor/invoices", { headers: { cookie } }))).status).toBe(401)
        expect((await call(api.get("/vendor/invoices", bearer(removedBearer)))).status).toBe(401)

        // Every answer is collected first, so a failure shows them all.
        const secrets = ["cus_secret", "cus_shut_secret", ADDRESS, promotion.code, store.id, shut.store.id]
        const reads = ["/vendor/invoices", "/vendor/orders", `/vendor/orders/${order.id}`, "/vendor/promotions", "/vendor/sellers/me", "/vendor/sellers/me/onboarding", "/vendor/me"]
        const answers: Array<{ who: string; call: string; status: number; leaks: string[] }> = []
        const ask = async (who: string, label: string, request: Promise<any>) => {
          const res = await call(request)
          const body = JSON.stringify(res.data ?? {})
          answers.push({ who, call: label, status: res.status, leaks: secrets.filter((s) => body.includes(s)) })
        }
        const pairs = [
          ["removed member", withSession(removedBearer, cookie)],
          ["closed store's member", withSession(tokenFor(shutMember, shutMember.memberId), cookie)],
          // A live seller's own bearer with another login's cookie: the
          // request names two logins, and nothing says which one is asking.
          ["live owner", withSession(tokenFor(owner, ownerMemberId), cookie)],
        ] as const
        for (const [who, pair] of pairs) {
          for (const path of reads) {
            await ask(who, `GET ${path}`, api.get(path, pair))
          }
          await ask(who, "POST /vendor/invoices", api.post("/vendor/invoices", { total: 999, customer_id: "cus_mallory", issue: false }, pair))
        }
        const written = {
          removed: (await invoicesOf(removed.memberId)).length,
          closed: (await invoicesOf(shutMember.memberId)).length,
          owner: (await invoicesOf(ownerMemberId)).length,
          cookieHolder: (await invoicesOf(elsewhere.ownerMemberId)).length,
        }

        expect({ answers, written }).toEqual({
          answers: pairs.flatMap(([who]) =>
            [...reads.map((path) => `GET ${path}`), "POST /vendor/invoices"].map((label) => ({ who, call: label, status: 401, leaks: [] }))
          ),
          written: { removed: 1, closed: 1, owner: 0, cookieHolder: 0 },
        })
      })

      it("a session and a bearer of the same login act as the bearer's member, and read and write", async () => {
        // A login's session can predate a change of its link: here it was made
        // while the login acted as the owner of one store, and the bearer acts
        // as its member of another.
        const first = await storeOf(`First Farm ${uid()}`)
        const second = await storeOf(`Second Farm ${uid()}`)
        const [secondMember] = await container()
          .resolve(SELLER_MODULE)
          .createMembers([{ seller_id: second.store.id, name: "Owner", email: first.owner.email, role: "member" }])
        const order = await orderFor(second.store)
        await assignSellerPlan(container(), second.store.id, "internal")
        const cookie = await sessionCookie(tokenFor(first.owner, first.ownerMemberId))
        await container().resolve(Modules.AUTH).updateAuthIdentities([{ id: first.owner.authIdentityId, app_metadata: { seller_id: secondMember.id } }])
        const both = withSession(tokenFor(first.owner, secondMember.id), cookie)

        // Collected first, so a failure shows every route's answer.
        const me = await call(api.get("/vendor/me", both))
        const profile = await call(api.get("/vendor/sellers/me", both))
        const orders = await call(api.get("/vendor/orders", both))
        const created = await call(api.post("/vendor/invoices", { total: 700, issue: false }, both))
        const listed = await call(api.get("/vendor/invoices", both))
        expect({
          member: [me.status, me.data?.member?.id, me.data?.member?.seller_id],
          store: [profile.status, profile.data?.seller?.id],
          orders: [orders.status, (orders.data?.orders ?? []).map((o: { id: string }) => o.id)],
          created: [created.status, created.data?.invoice?.seller_id],
          listed: [listed.status, (listed.data?.invoices ?? []).map((i: { id: string }) => i.id)],
          underTheSessionsMember: (await invoicesOf(first.ownerMemberId)).length,
        }).toEqual({
          member: [200, secondMember.id, second.store.id],
          store: [200, second.store.id],
          orders: [200, [order.id]],
          created: [201, secondMember.id],
          listed: [200, [created.data?.invoice?.id]],
          underTheSessionsMember: 0,
        })
      })

      it("an owner and a member still on the team, with a bearer alone, read and write invoices and orders", async () => {
        const { owner, ownerMemberId, store } = await storeOf(`Bearer Farm ${uid()}`)
        const order = await orderFor(store)
        await assignSellerPlan(container(), store.id, "internal")
        const active = await teamMember(store, "active")

        for (const [token, memberId, who] of [
          [tokenFor(owner, ownerMemberId), ownerMemberId, "owner"],
          [tokenFor(active, active.memberId), active.memberId, "member"],
        ] as const) {
          const created = await call(api.post("/vendor/invoices", { total: 500, issue: false }, bearer(token)))
          expect({ who, status: created.status }).toEqual({ who, status: 201 })
          expect({ who, keyedTo: created.data.invoice.seller_id }).toEqual({ who, keyedTo: memberId })
          const listed = await call(api.get("/vendor/invoices", bearer(token)))
          expect({ who, status: listed.status, ids: listed.data.invoices.map((i: { id: string }) => i.id) }).toEqual({
            who,
            status: 200,
            ids: [created.data.invoice.id],
          })
          const orders = await call(api.get("/vendor/orders", bearer(token)))
          expect({ who, status: orders.status, ids: orders.data.orders.map((o: { id: string }) => o.id) }).toEqual({ who, status: 200, ids: [order.id] })
        }
      })

      it("once the gate lets a request through, a later authenticate that reads another login's token does not change who it acts as", async () => {
        // Medusa's authenticate replaces req.auth_context wholesale. Nothing
        // after the gate on /vendor reads another credential today (the
        // route-level matchers re-read the bearer the gate validated), so this
        // drives the gate and then Medusa's own authenticate directly, with the
        // header swapped between them.
        const { owner, ownerMemberId, store } = await storeOf(`Pinned Farm ${uid()}`)
        const other = await storeOf(`Other Pinned Farm ${uid()}`)
        const otherBearer = `Bearer ${tokenFor(other.owner, other.ownerMemberId)}`
        const resStub = () => {
          const res: any = { statusCode: 200 }
          res.status = (code: number) => ((res.statusCode = code), res)
          res.json = (body: unknown) => ((res.body = body), res)
          return res
        }
        const through = async (token: string) => {
          const req: any = {
            method: "GET",
            originalUrl: "/vendor/invoices",
            url: "/vendor/invoices",
            path: "/vendor/invoices",
            headers: { authorization: `Bearer ${token}` },
            scope: container(),
            session: {},
          }
          const res = resStub()
          let passed = false
          await ensureSellerContext(req, res, () => {
            passed = true
          })
          expect({ passed, status: res.statusCode }).toEqual({ passed: true, status: 200 })
          return req
        }
        const expected = { actor_id: ownerMemberId, auth_identity_id: owner.authIdentityId }

        for (const [token, which] of [[tokenFor(owner, ownerMemberId), "member id"], [tokenFor(owner, store.id), "seller id"]] as const) {
          const req = await through(token)
          expect({ which, ctx: req.auth_context }).toEqual({ which, ctx: expect.objectContaining(expected) })

          // The same token read again: a seller id still acts as its member.
          let again = false
          await authenticate("seller", "bearer")(req, resStub(), () => {
            again = true
          })
          expect({ which, again, ctx: req.auth_context }).toEqual({ which, again: true, ctx: expect.objectContaining(expected) })

          // Another login's token: Medusa accepts it and assigns its context, which does not take.
          req.headers.authorization = otherBearer
          let swapped = false
          await authenticate("seller", "bearer")(req, resStub(), () => {
            swapped = true
          })
          expect({ which, swapped, ctx: req.auth_context }).toEqual({ which, swapped: true, ctx: expect.objectContaining(expected) })

          // Nor does writing the fields.
          req.auth_context.actor_id = other.ownerMemberId
          req.auth_context.auth_identity_id = other.owner.authIdentityId
          expect({ which, ctx: req.auth_context }).toEqual({ which, ctx: expect.objectContaining(expected) })
        }
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
