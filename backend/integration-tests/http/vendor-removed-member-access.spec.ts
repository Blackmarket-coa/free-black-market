import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow, deleteMemberWorkflow } from "@mercurjs/b2c-core/workflows"
import { PLAYBOOK_MODULE } from "../../src/modules/playbook"
import seedPlaybooks from "../../src/scripts/seed-playbooks"
import {
  firstLiveMemberIdOf,
  liveSellerIdForActor,
  sellerIdForVendorActor,
} from "../../src/shared/seller-actor"
import { createAuthenticatedSeller } from "./helpers/seller-auth"

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
 * Members are removed with Mercur's own deleteMemberWorkflow. Spends 9 of the
 * auth limiter's 20 a minute (seller register and sign-ins).
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
      const password = `Pw-${uid()}-Aa1!`
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
        await auth.register("emailpass", { body: { email: ownerEmail, password: "Pw-closed-Aa1!" } } as any)
        const [ownerProvider] = await auth.listProviderIdentities({ entity_id: ownerEmail, provider: "emailpass" })
        const { result: store } = await createSellerWorkflow.run({
          container: container(),
          input: { auth_identity_id: ownerProvider.auth_identity_id, member: { name: "Owner", email: ownerEmail }, seller: { name: `Closed Farm ${uid()}` } } as any,
        })
        // What a finished approval leaves: the login linked by seller id.
        await auth.updateAuthIdentities([{ id: ownerProvider.auth_identity_id, app_metadata: { seller_id: store.id } }])
        const ownerToken = await signIn({ email: ownerEmail, password: "Pw-closed-Aa1!" })
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

    describe("the rule both gates and the routes behind them read (shared/seller-actor.ts)", () => {
      it("resolves a member or seller id to a store only while both are live", async () => {
        const auth = container().resolve(Modules.AUTH)
        const email = `rule-owner-${uid()}@example.com`
        await auth.register("emailpass", { body: { email, password: "Pw-rule-Aa1!" } } as any)
        const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
        const { result: store } = await createSellerWorkflow.run({
          container: container(),
          input: { auth_identity_id: provider.auth_identity_id, member: { name: "Owner", email }, seller: { name: `Rule Farm ${uid()}` } } as any,
        })
        const [ownerMember] = await container().resolve(SELLER_MODULE).listMembers({ seller_id: store.id })
        const active = await teamMember(store, "active")
        const removed = await teamMember(store, "removed")
        await deleteMemberWorkflow.run({ container: container(), input: removed.memberId })
        const scope = container()

        expect(await liveSellerIdForActor(scope, active.memberId)).toBe(store.id)
        expect(await liveSellerIdForActor(scope, store.id)).toBe(store.id)
        expect(await liveSellerIdForActor(scope, removed.memberId)).toBeNull()
        expect(await liveSellerIdForActor(scope, "cus_not_a_seller")).toBeNull()
        expect(await sellerIdForVendorActor(scope, active.memberId)).toBe(store.id)
        expect(await sellerIdForVendorActor(scope, removed.memberId)).toBeUndefined()
        expect(await firstLiveMemberIdOf(scope, store.id)).toBe(ownerMember.id)
        // A seller id never acts as a member that is gone, even the first one.
        // Mercur will not delete an owner, so the row is soft-deleted directly.
        await container().resolve(SELLER_MODULE).softDeleteMembers([ownerMember.id])
        expect(await firstLiveMemberIdOf(scope, store.id)).toBe(active.memberId)

        await container().resolve(SELLER_MODULE).softDeleteSellers([store.id])
        expect(await liveSellerIdForActor(scope, active.memberId)).toBeNull()
        expect(await liveSellerIdForActor(scope, store.id)).toBeNull()
        expect(await sellerIdForVendorActor(scope, active.memberId)).toBeUndefined()
      })
    })
  },
})
