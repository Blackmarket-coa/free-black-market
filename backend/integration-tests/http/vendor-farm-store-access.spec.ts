import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import { assignSellerPlan } from "./helpers/seller-auth"
import { newTestPassword } from "./helpers/test-password"
import { createPublishableKeyToken, pakHeaders } from "./_publishable-key"

jest.setTimeout(300 * 1000)

/**
 * The farm routes act for the caller's store, on that store's farm records
 * only, on the real server and a migrated database (SD-145 follow-up, from
 * the review of the vendor-panel token fix that makes the farm screens reach
 * these routes).
 *
 * Measured on Postgres before the fix: every farm route answered 500 at its
 * first read, which queried the seller-producer link as `producer_seller`, an
 * alias that does not exist; POST /vendor/farm/profile could not create a
 * producer (its required `seller_id` was never set) and linked with a shape
 * Medusa's Link throws on; POST /vendor/farm/harvests wrote the harvest and
 * then threw on the same kind of link; the lot routes checked only that the
 * caller had some farm profile; every partial PUT answered 500; and DELETE
 * answered 204 with no body, which the panel's SDK reports as a failure.
 *
 * Stores are made the way approval makes one, with a second member linked to
 * its own member row; tokens carry the claims Medusa mints at sign-in.
 */

const FORBIDDEN = { message: "You do not have access to this record.", type: "not_allowed" }

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })
    const pg = () => container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const query = () => container().resolve(ContainerRegistrationKeys.QUERY)
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)

    type Login = { email: string; authIdentityId: string }
    type Team = { store: { id: string }; owner: string; member: string }

    async function plainLogin(prefix: string): Promise<Login> {
      const email = `${prefix}-${uid()}@example.com`
      const auth = container().resolve(Modules.AUTH)
      await auth.register("emailpass", { body: { email, password: newTestPassword(prefix) } } as any)
      const [provider] = await auth.listProviderIdentities({ entity_id: email, provider: "emailpass" })
      return { email, authIdentityId: provider.auth_identity_id as string }
    }

    /** The claims Medusa mints at sign-in: the login's linked member as the actor. */
    const tokenFor = (who: Login, memberId: string) =>
      jwt.sign(
        { actor_id: memberId, actor_type: "seller", auth_identity_id: who.authIdentityId, auth_provider: "emailpass", app_metadata: { seller_id: memberId }, user_metadata: {} },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      )

    /** A store made the way approval makes one; its owner's token and a second member's. */
    async function team(name: string): Promise<Team> {
      const ownerLogin = await plainLogin("owner")
      const { result: store } = await createSellerWorkflow.run({
        container: container(),
        input: { auth_identity_id: ownerLogin.authIdentityId, member: { name: "Owner", email: ownerLogin.email }, seller: { name } } as any,
      })
      const [ownerMember] = await container().resolve(SELLER_MODULE).listMembers({ seller_id: store.id })
      await assignSellerPlan(container(), store.id, "internal")
      const memberLogin = await plainLogin("member")
      const [member] = await container()
        .resolve(SELLER_MODULE)
        .createMembers([{ seller_id: store.id, name: "Member", email: memberLogin.email, role: "member" }])
      await container().resolve(Modules.AUTH).updateAuthIdentities([{ id: memberLogin.authIdentityId, app_metadata: { seller_id: member.id } }])
      return { store, owner: tokenFor(ownerLogin, ownerMember.id), member: tokenFor(memberLogin, member.id) }
    }

    /** POST /vendor/farm/profile as this caller. */
    async function farmProfile(token: string, handle = `farm-${uid()}`) {
      const res = await call(api.post("/vendor/farm/profile", { name: `Farm ${handle}`, handle, year_established: 2001 }, bearer(token)))
      expect({ status: res.status, body: res.data }).toMatchObject({ status: 201 })
      return res.data.producer as { id: string; seller_id: string; handle: string }
    }

    const linkRowsOf = async (producerId: string) =>
      (await pg().raw(`SELECT seller_id FROM seller_seller_producer_producer WHERE producer_id = ? AND deleted_at IS NULL`, [producerId])).rows.map(
        (r: { seller_id: string }) => r.seller_id
      )
    const producersWithHandle = async (handle: string) =>
      (await pg().raw(`SELECT id FROM producer WHERE handle = ?`, [handle])).rows.map((r: { id: string }) => r.id)
    const lotRow = async (lotId: string) =>
      (await pg().raw(`SELECT id, storage_location, surplus_flag, deleted_at FROM lot WHERE id = ?`, [lotId])).rows[0]

    afterEach(() => {
      jest.restoreAllMocks()
    })

    describe("the store's farm profile", () => {
      it("a member creates it; it is the store's and linked to it; the other member reads and edits it; a second one is refused", async () => {
        const a = await team(`Profile Farm ${uid()}`)
        const b = await team(`Other Farm ${uid()}`)

        const producer = await farmProfile(a.member)
        expect(producer.seller_id).toBe(a.store.id)
        expect(await linkRowsOf(producer.id)).toEqual([a.store.id])
        const { data: links } = await query().graph({ entity: "seller_producer", fields: ["seller_id", "producer_id"], filters: { seller_id: a.store.id } })
        expect(links.map((l: { producer_id: string }) => l.producer_id)).toEqual([producer.id])

        const read = await call(api.get("/vendor/farm/profile", bearer(a.owner)))
        expect({ status: read.status, id: read.data?.producer?.id }).toEqual({ status: 200, id: producer.id })
        // A partial update: the fields not sent are left as they were.
        const edited = await call(api.put("/vendor/farm/profile", { story: "Three generations on this land" }, bearer(a.owner)))
        expect({ status: edited.status, story: edited.data?.producer?.story, name: edited.data?.producer?.name }).toEqual({
          status: 200,
          story: "Three generations on this land",
          name: `Farm ${producer.handle}`,
        })

        const second = await call(api.post("/vendor/farm/profile", { name: "Second", handle: `second-${uid()}` }, bearer(a.owner)))
        expect(second.status).toBe(409)
        const other = await call(api.get("/vendor/farm/profile", bearer(b.member)))
        expect({ status: other.status, producer: other.data?.producer }).toEqual({ status: 200, producer: null })
      })

      it("a link that cannot be made leaves no producer behind: nothing is listed publicly, and the retry works", async () => {
        const c = await team(`Retry Farm ${uid()}`)
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const handle = `retry-farm-${uid()}`
        const refused = jest.spyOn(link(), "create").mockRejectedValueOnce(new Error("link refused for the test"))

        const failed = await call(api.post("/vendor/farm/profile", { name: "Retry Farm", handle }, bearer(c.member)))
        expect({ status: failed.status, error: failed.data?.error }).toEqual({ status: 500, error: "link refused for the test" })
        // The route's own link call was the one refused.
        expect(refused).toHaveBeenCalledTimes(1)
        expect(await producersWithHandle(handle)).toEqual([])
        const listed = await api.get("/store/producers", pak)
        expect(listed.data.producers.map((p: { handle: string }) => p.handle)).not.toContain(handle)

        refused.mockRestore()
        const retried = await farmProfile(c.member, handle)
        expect(await linkRowsOf(retried.id)).toEqual([c.store.id])
        expect((await api.get("/store/producers", pak)).data.producers.map((p: { handle: string }) => p.handle)).toContain(handle)
      })
    })

    describe("harvests and lots", () => {
      it("another store's lots and harvests are refused, with nothing changed; the store's own work for both members", async () => {
        const a = await team(`Lot Farm ${uid()}`)
        const b = await team(`Rival Farm ${uid()}`)
        const noFarm = await team(`No Farm ${uid()}`)
        await farmProfile(a.owner)
        await farmProfile(b.owner)

        const harvest = await call(api.post("/vendor/farm/harvests", { crop_name: "Heirloom Tomatoes", year: 2026 }, bearer(a.member)))
        expect({ status: harvest.status, body: harvest.data }).toMatchObject({ status: 201 })
        const harvestId: string = harvest.data.harvest.id
        const { data: harvestLinks } = await query().graph({ entity: "producer_harvest", fields: ["harvest_id"], filters: { harvest_id: harvestId } })
        expect(harvestLinks.map((l: { harvest_id: string }) => l.harvest_id)).toEqual([harvestId])
        const lot = await call(api.post(`/vendor/farm/harvests/${harvestId}/lots`, { quantity_total: 40, unit: "lb" }, bearer(a.owner)))
        expect({ status: lot.status, body: lot.data }).toMatchObject({ status: 201 })
        const lotId: string = lot.data.lot.id
        const before = await lotRow(lotId)

        const [product] = await container()
          .resolve(Modules.PRODUCT)
          .createProducts([{ title: `Tomato box ${uid()}`, handle: `tomato-box-${uid()}`, status: "published" }])
        await link().create({ [SELLER_MODULE]: { seller_id: a.store.id }, [Modules.PRODUCT]: { product_id: product.id } })

        // Another store with its own farm profile: refused on every lot and harvest route.
        // One at a time, so nothing races what it checks.
        const lotCalls: Array<[string, () => Promise<any>]> = [
          ["GET lot", () => api.get(`/vendor/farm/lots/${lotId}`, bearer(b.owner))],
          ["PUT lot", () => api.put(`/vendor/farm/lots/${lotId}`, { storage_location: "Rival barn" }, bearer(b.owner))],
          ["DELETE lot", () => api.delete(`/vendor/farm/lots/${lotId}`, bearer(b.member))],
          ["POST surplus", () => api.post(`/vendor/farm/lots/${lotId}/surplus`, { reason: "rival" }, bearer(b.owner))],
          ["DELETE surplus", () => api.delete(`/vendor/farm/lots/${lotId}/surplus`, bearer(b.member))],
          ["POST availability", () => api.post(`/vendor/farm/lots/${lotId}/availability`, { unit_price: 1 }, bearer(b.owner))],
          ["GET availability", () => api.get(`/vendor/farm/lots/${lotId}/availability`, bearer(b.owner))],
          ["POST link-product", () => api.post(`/vendor/farm/lots/${lotId}/link-product`, { product_id: product.id }, bearer(b.owner))],
          ["GET link-product", () => api.get(`/vendor/farm/lots/${lotId}/link-product`, bearer(b.member))],
          ["DELETE link-product", () => api.delete(`/vendor/farm/lots/${lotId}/link-product`, { ...bearer(b.owner), data: { availability_window_id: "aw_none" } })],
          ["GET harvest", () => api.get(`/vendor/farm/harvests/${harvestId}`, bearer(b.owner))],
          ["PUT harvest", () => api.put(`/vendor/farm/harvests/${harvestId}`, { farmer_notes: "rival" }, bearer(b.owner))],
          ["DELETE harvest", () => api.delete(`/vendor/farm/harvests/${harvestId}`, bearer(b.member))],
          ["POST harvest lot", () => api.post(`/vendor/farm/harvests/${harvestId}/lots`, { quantity_total: 1, unit: "lb" }, bearer(b.owner))],
        ]
        for (const [label, send] of lotCalls) {
          const res = await call(send())
          expect({ label, status: res.status, body: res.data }).toEqual({ label, status: 403, body: FORBIDDEN })
        }
        expect(await lotRow(lotId)).toEqual(before)
        const { data: windows } = await query().graph({ entity: "availability_window", fields: ["id"], filters: { lot_id: lotId } })
        expect(windows).toEqual([])
        const { data: harvestLots } = await query().graph({ entity: "lot", fields: ["id"], filters: { harvest_id: harvestId } })
        expect(harvestLots.map((l: { id: string }) => l.id)).toEqual([lotId])
        const { data: harvests } = await query().graph({ entity: "harvest", fields: ["id", "farmer_notes"], filters: { id: harvestId } })
        expect(harvests.map((h: { id: string; farmer_notes: string | null }) => [h.id, h.farmer_notes])).toEqual([[harvestId, null]])

        // A lot that does not exist gets the same answer as another store's.
        const missing = await call(api.put(`/vendor/farm/lots/lot_does_not_exist`, { storage_location: "x" }, bearer(b.owner)))
        expect({ status: missing.status, body: missing.data }).toEqual({ status: 403, body: FORBIDDEN })
        const withoutProfile = await call(api.put(`/vendor/farm/lots/${lotId}`, { storage_location: "x" }, bearer(noFarm.owner)))
        expect({ status: withoutProfile.status, message: withoutProfile.data?.message }).toEqual({ status: 403, message: "No farm profile found" })

        // The store's own lot and harvest, for both members, with partial bodies.
        const moved = await call(api.put(`/vendor/farm/lots/${lotId}`, { storage_location: "Cold room 2" }, bearer(a.member)))
        expect({ status: moved.status, location: moved.data?.lot?.storage_location, unit: moved.data?.lot?.unit }).toEqual({
          status: 200,
          location: "Cold room 2",
          unit: "lb",
        })
        const read = await call(api.get(`/vendor/farm/lots/${lotId}`, bearer(a.owner)))
        expect({ status: read.status, harvest: read.data?.lot?.harvest?.id, windows: read.data?.lot?.availability_windows }).toEqual({
          status: 200,
          harvest: harvestId,
          windows: [],
        })
        const noted = await call(api.put(`/vendor/farm/harvests/${harvestId}`, { farmer_notes: "Dry-farmed" }, bearer(a.owner)))
        expect({ status: noted.status, notes: noted.data?.harvest?.farmer_notes }).toEqual({ status: 200, notes: "Dry-farmed" })
        const offered = await call(api.post(`/vendor/farm/lots/${lotId}/link-product`, { product_id: product.id, unit_price: 6 }, bearer(a.member)))
        expect({ status: offered.status, body: offered.data }).toMatchObject({ status: 201 })
        const { data: productLinks } = await query().graph({
          entity: "product_availability_window",
          fields: ["product_id", "availability_window_id"],
          filters: { product_id: product.id },
        })
        expect(productLinks.map((l: { product_id: string; availability_window_id: string }) => [l.product_id, l.availability_window_id])).toEqual([
          [product.id, offered.data.availability_window.id],
        ])
        const listedWindows = await call(api.get(`/vendor/farm/lots/${lotId}/link-product`, bearer(a.owner)))
        expect(listedWindows.data.linked_products.map((w: { id: string }) => w.id)).toEqual([offered.data.availability_window.id])
      })

      it("DELETE answers 200 with Medusa's deletion body, not an empty 204", async () => {
        const a = await team(`Delete Farm ${uid()}`)
        await farmProfile(a.owner)
        const harvest = await call(api.post("/vendor/farm/harvests", { crop_name: "Garlic", year: 2026 }, bearer(a.owner)))
        const harvestId: string = harvest.data.harvest.id
        const lot = await call(api.post(`/vendor/farm/harvests/${harvestId}/lots`, { quantity_total: 5, unit: "lb" }, bearer(a.owner)))
        const lotId: string = lot.data.lot.id

        const lotDeleted = await call(api.delete(`/vendor/farm/lots/${lotId}`, bearer(a.member)))
        expect({ status: lotDeleted.status, body: lotDeleted.data, json: String(lotDeleted.headers["content-type"]).includes("application/json") }).toEqual({
          status: 200,
          body: { id: lotId, object: "lot", deleted: true },
          json: true,
        })
        const { data: lotsLeft } = await query().graph({ entity: "lot", fields: ["id"], filters: { id: lotId } })
        expect(lotsLeft).toEqual([])

        const harvestDeleted = await call(api.delete(`/vendor/farm/harvests/${harvestId}`, bearer(a.owner)))
        expect({ status: harvestDeleted.status, body: harvestDeleted.data }).toEqual({
          status: 200,
          body: { id: harvestId, object: "harvest", deleted: true },
        })
        const { data: harvestsLeft } = await query().graph({ entity: "harvest", fields: ["id"], filters: { id: harvestId } })
        expect(harvestsLeft).toEqual([])
      })
    })
  },
})
