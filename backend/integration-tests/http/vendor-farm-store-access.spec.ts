import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import { PRODUCER_MODULE } from "../../src/modules/producer"
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

    /** A product of the store, one variant. */
    async function storeProduct(storeId: string) {
      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([
          {
            title: `Tomato box ${uid()}`,
            handle: `tomato-box-${uid()}`,
            status: "published",
            options: [{ title: "Size", values: ["Box"] }],
            variants: [{ title: "Box", options: { Size: "Box" } }],
          },
        ])
      await link().create({ [SELLER_MODULE]: { seller_id: storeId }, [Modules.PRODUCT]: { product_id: product.id } })
      return product as { id: string; variants: Array<{ id: string }> }
    }

    /** The variant's inventory item, stocked at a location of the store. */
    async function stockAt(storeId: string, variantId: string, quantity: number) {
      const inventory = container().resolve(Modules.INVENTORY)
      const [item] = await inventory.createInventoryItems([{ sku: `sku-${uid()}` }])
      await link().create({ [Modules.PRODUCT]: { variant_id: variantId }, [Modules.INVENTORY]: { inventory_item_id: item.id } })
      const [location] = await container().resolve(Modules.STOCK_LOCATION).createStockLocations([{ name: `Barn ${uid()}` }])
      await link().create({ [SELLER_MODULE]: { seller_id: storeId }, [Modules.STOCK_LOCATION]: { stock_location_id: location.id } })
      await inventory.createInventoryLevels([{ inventory_item_id: item.id, location_id: location.id, stocked_quantity: quantity }])
      return { inventoryItemId: item.id as string, locationId: location.id as string }
    }

    const stockedOf = async (inventoryItemId: string, locationId: string) => {
      const [level] = await container()
        .resolve(Modules.INVENTORY)
        .listInventoryLevels({ inventory_item_id: inventoryItemId, location_id: locationId })
      return Number(level?.stocked_quantity)
    }

    /** A harvest and one lot of it, through the routes. */
    async function harvestWithLot(token: string, quantity: number) {
      const harvest = await call(api.post("/vendor/farm/harvests", { crop_name: `Crop ${uid()}`, year: 2026 }, bearer(token)))
      expect({ status: harvest.status, body: harvest.data }).toMatchObject({ status: 201 })
      const lot = await call(api.post(`/vendor/farm/harvests/${harvest.data.harvest.id}/lots`, { quantity_total: quantity, unit: "lb" }, bearer(token)))
      expect({ status: lot.status, body: lot.data }).toMatchObject({ status: 201 })
      return { harvestId: harvest.data.harvest.id as string, lotId: lot.data.lot.id as string }
    }

    afterEach(() => {
      jest.restoreAllMocks()
    })

    describe("the store's farm profile", () => {
      it("a member creates it; it is the store's and linked to it; the other member reads and edits it; a second one is refused", async () => {
        const a = await team(`Profile Farm ${uid()}`)
        const b = await team(`Other Farm ${uid()}`)

        const producer = await farmProfile(a.member)
        expect(producer.seller_id).toBe(a.store.id)
        // Created not public, and made public once linked.
        expect((producer as { public_profile_enabled?: boolean }).public_profile_enabled).toBe(true)
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
        // What failed, and not the error's own text (logged instead).
        expect({ status: failed.status, body: failed.data }).toEqual({ status: 500, body: { message: "Failed to create farm profile" } })
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
      it("a handle another farm uses, and a store that already has a profile, each get 409 with their own message, also when creates race", async () => {
        const a = await team(`Handle Farm ${uid()}`)
        const b = await team(`Copy Farm ${uid()}`)
        // A handle with "seller_id" in it: the clash's column is read from the
        // error's fixed prefix, not searched for in its text, where the
        // handle appears too.
        const taken = await farmProfile(a.owner, `farm-seller_id-${uid()}`)

        const handleClash = await call(api.post("/vendor/farm/profile", { name: "Copy", handle: taken.handle }, bearer(b.owner)))
        expect({ status: handleClash.status, body: handleClash.data }).toEqual({ status: 409, body: { message: "That farm handle is already taken" } })
        // The same on PUT, which no longer answers the error's text.
        await farmProfile(b.owner)
        const renamed = await call(api.put("/vendor/farm/profile", { handle: taken.handle }, bearer(b.member)))
        expect({ status: renamed.status, body: renamed.data }).toEqual({ status: 409, body: { message: "That farm handle is already taken" } })

        // Two creates for one store racing past the check: the second meets
        // the producer's unique seller_id, and is told the store has a profile.
        const producers = container().resolve(PRODUCER_MODULE)
        const raced = jest.spyOn(producers, "listProducers").mockResolvedValueOnce([])
        const second = await call(api.post("/vendor/farm/profile", { name: "Again", handle: `again-${uid()}` }, bearer(a.member)))
        expect(raced).toHaveBeenCalledTimes(1)
        expect({ status: second.status, message: second.data?.message }).toEqual({ status: 409, message: "This store already has a farm profile" })
        expect((await pg().raw(`SELECT count(*)::int AS n FROM producer WHERE seller_id = ?`, [a.store.id])).rows[0].n).toBe(1)
      })

      it("when the undo fails too, the answer says a producer was left, and it is not public", async () => {
        const c = await team(`Stuck Farm ${uid()}`)
        const pak = pakHeaders(await createPublishableKeyToken(getContainer))
        const handle = `stuck-farm-${uid()}`
        const linkCreate = jest.spyOn(link(), "create").mockRejectedValueOnce(new Error("link refused for the test"))
        const undo = jest.spyOn(container().resolve(PRODUCER_MODULE), "deleteProducers").mockRejectedValueOnce(new Error("delete refused for the test"))

        const failed = await call(api.post("/vendor/farm/profile", { name: "Stuck Farm", handle }, bearer(c.owner)))
        expect(undo).toHaveBeenCalledTimes(1)
        const [left] = (await pg().raw(`SELECT id, public_profile_enabled FROM producer WHERE handle = ?`, [handle])).rows
        expect({ status: failed.status, body: failed.data }).toEqual({
          status: 500,
          body: {
            message:
              "Failed to create farm profile. A producer record was left behind, unlinked and not public; contact support to remove it.",
            producer_id: left.id,
          },
        })
        expect(left.public_profile_enabled).toBe(false)
        expect(await linkRowsOf(left.id)).toEqual([])
        const listedHandles = async () => (await api.get("/store/producers", pak)).data.producers.map((p: { handle: string }) => p.handle)
        expect(await listedHandles()).not.toContain(handle)
        const publicOf = async () => (await pg().raw(`SELECT public_profile_enabled FROM producer WHERE id = ?`, [left.id])).rows[0].public_profile_enabled

        // Making it public makes the missing link first. When that fails too:
        // 409, and it stays unlinked, not public, and unlisted.
        linkCreate.mockClear().mockRejectedValueOnce(new Error("link refused again for the test"))
        const refused = await call(api.put("/vendor/farm/profile", { public_profile_enabled: true }, bearer(c.member)))
        expect(linkCreate).toHaveBeenCalledTimes(1)
        expect({ status: refused.status, body: refused.data }).toEqual({
          status: 409,
          body: {
            message:
              "This farm profile is not linked to your store yet and could not be linked now, so it was not made public. Try again, or contact support.",
          },
        })
        expect(await publicOf()).toBe(false)
        expect(await linkRowsOf(left.id)).toEqual([])
        expect(await listedHandles()).not.toContain(handle)
        linkCreate.mockRestore()

        // Only true or false. Without the check a string skipped the link step
        // and answered 500 from the update (measured by mutation).
        const stringly = await call(api.put("/vendor/farm/profile", { public_profile_enabled: "true" }, bearer(c.member)))
        expect({ status: stringly.status, body: stringly.data }).toEqual({
          status: 400,
          body: { message: "public_profile_enabled must be true or false", type: "invalid_data" },
        })
        expect(await publicOf()).toBe(false)

        // When the link can be made: linked to the store, then public and listed.
        const published = await call(api.put("/vendor/farm/profile", { public_profile_enabled: true }, bearer(c.owner)))
        expect({ status: published.status, id: published.data?.producer?.id, public: published.data?.producer?.public_profile_enabled }).toEqual({
          status: 200,
          id: left.id,
          public: true,
        })
        expect(await linkRowsOf(left.id)).toEqual([c.store.id])
        expect(await listedHandles()).toContain(handle)
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

      it("link-product refuses another store's variant or stock location and leaves their inventory as it was; the store's own sync works", async () => {
        const a = await team(`Sync Farm ${uid()}`)
        const b = await team(`Stock Shop ${uid()}`)
        await farmProfile(a.owner)
        const { lotId } = await harvestWithLot(a.owner, 3)
        const own = await storeProduct(a.store.id)
        const ownStock = await stockAt(a.store.id, own.variants[0].id, 20)
        const theirs = await storeProduct(b.store.id)
        const theirStock = await stockAt(b.store.id, theirs.variants[0].id, 50)
        const windowsOf = async () => (await query().graph({ entity: "availability_window", fields: ["id"], filters: { lot_id: lotId } })).data

        // The review's case: A's product, B's variant and B's location.
        for (const [label, body] of [
          ["B's variant and location", { variant_id: theirs.variants[0].id, location_id: theirStock.locationId }],
          ["B's location", { variant_id: own.variants[0].id, location_id: theirStock.locationId }],
          ["B's variant", { variant_id: theirs.variants[0].id, location_id: ownStock.locationId }],
        ] as const) {
          const res = await call(
            api.post(`/vendor/farm/lots/${lotId}/link-product`, { product_id: own.id, sync_inventory: true, ...body }, bearer(a.member))
          )
          expect({ label, status: res.status, body: res.data }).toEqual({ label, status: 403, body: FORBIDDEN })
        }
        expect(await stockedOf(theirStock.inventoryItemId, theirStock.locationId)).toBe(50)
        expect(await stockedOf(ownStock.inventoryItemId, ownStock.locationId)).toBe(20)
        expect(await windowsOf()).toEqual([])

        // The store's own variant at its own location: linked, and synced to the lot.
        const synced = await call(
          api.post(
            `/vendor/farm/lots/${lotId}/link-product`,
            { product_id: own.id, variant_id: own.variants[0].id, location_id: ownStock.locationId, sync_inventory: true },
            bearer(a.member)
          )
        )
        expect({ status: synced.status, message: synced.data?.message }).toEqual({ status: 201, message: "Product linked successfully" })
        expect(await stockedOf(ownStock.inventoryItemId, ownStock.locationId)).toBe(3)
        expect(await stockedOf(theirStock.inventoryItemId, theirStock.locationId)).toBe(50)
      })

      it("an availability window takes only the store's own product", async () => {
        const a = await team(`Window Farm ${uid()}`)
        const b = await team(`Window Shop ${uid()}`)
        await farmProfile(a.owner)
        const { lotId } = await harvestWithLot(a.owner, 8)
        const own = await storeProduct(a.store.id)
        const theirs = await storeProduct(b.store.id)

        const foreign = await call(api.post(`/vendor/farm/lots/${lotId}/availability`, { product_id: theirs.id, unit_price: 4 }, bearer(a.member)))
        expect({ status: foreign.status, body: foreign.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect((await query().graph({ entity: "availability_window", fields: ["id"], filters: { lot_id: lotId } })).data).toEqual([])

        const ownWindow = await call(api.post(`/vendor/farm/lots/${lotId}/availability`, { product_id: own.id, unit_price: 4 }, bearer(a.owner)))
        expect({ status: ownWindow.status, product: ownWindow.data?.availability_window?.product_id }).toEqual({ status: 201, product: own.id })
        const bare = await call(api.post(`/vendor/farm/lots/${lotId}/availability`, { unit_price: 4 }, bearer(a.member)))
        expect(bare.status).toBe(201)
      })

      it("ids are one string each: an array, which a filter reads as IN, is refused with 400 before any check, and nothing is written or unlinked", async () => {
        const a = await team(`Array Farm ${uid()}`)
        const b = await team(`Array Shop ${uid()}`)
        await farmProfile(a.owner)
        await farmProfile(b.owner)
        const { lotId } = await harvestWithLot(a.owner, 5)
        const own = await storeProduct(a.store.id)
        const theirs = await storeProduct(b.store.id)
        const windowsOf = async (id: string) =>
          (
            await query().graph({ entity: "availability_window", fields: ["id", "product_id", "is_active"], filters: { lot_id: id } })
          ).data.map((w: { id: string; product_id: string | null; is_active: boolean }) => [w.product_id, w.is_active])
        const productLinksOf = async (productId: string) =>
          (await query().graph({ entity: "product_availability_window", fields: ["availability_window_id"], filters: { product_id: productId } })).data
        const oneId = (field: string) => ({ message: `${field} must be one id`, type: "invalid_data" })

        // The review's case: the store's product and another store's, as one
        // product_id. It passed the seller_product check and its INSERT failed
        // with the SQL in the 500.
        for (const [label, path, body, field] of [
          ["link-product product_id", "link-product", { product_id: [own.id, theirs.id] }, "product_id"],
          ["link-product variant_id", "link-product", { product_id: own.id, variant_id: [own.variants[0].id, theirs.variants[0].id] }, "variant_id"],
          ["link-product location_id", "link-product", { product_id: own.id, location_id: { $ne: null } }, "location_id"],
          ["availability product_id", "availability", { product_id: [own.id, theirs.id] }, "product_id"],
        ] as const) {
          const res = await call(api.post(`/vendor/farm/lots/${lotId}/${path}`, body, bearer(a.member)))
          expect({ label, status: res.status, body: res.data }).toEqual({ label, status: 400, body: oneId(field) })
        }
        expect(await windowsOf(lotId)).toEqual([])
        expect(await productLinksOf(own.id)).toEqual([])
        expect(await productLinksOf(theirs.id)).toEqual([])

        // DELETE with the store's window and another store's in one array:
        // refused, and both stay offered and linked.
        const offered = await call(api.post(`/vendor/farm/lots/${lotId}/link-product`, { product_id: own.id }, bearer(a.member)))
        expect(offered.status).toBe(201)
        const theirLot = await harvestWithLot(b.owner, 2)
        const theirOffer = await call(api.post(`/vendor/farm/lots/${theirLot.lotId}/link-product`, { product_id: theirs.id }, bearer(b.owner)))
        expect(theirOffer.status).toBe(201)
        const unlink = await call(
          api.delete(`/vendor/farm/lots/${lotId}/link-product`, {
            ...bearer(a.member),
            data: { availability_window_id: [offered.data.availability_window.id, theirOffer.data.availability_window.id] },
          })
        )
        expect({ status: unlink.status, body: unlink.data }).toEqual({ status: 400, body: oneId("availability_window_id") })
        expect(await windowsOf(lotId)).toEqual([[own.id, true]])
        expect(await windowsOf(theirLot.lotId)).toEqual([[theirs.id, true]])
        expect((await productLinksOf(own.id)).length).toBe(1)
        expect((await productLinksOf(theirs.id)).length).toBe(1)
      })

      it("DELETE answers 200 with Medusa's deletion body; a lot takes its windows and their product links with it, and a harvest its lots and its producer link", async () => {
        const a = await team(`Delete Farm ${uid()}`)
        await farmProfile(a.owner)
        const product = await storeProduct(a.store.id)
        const { harvestId, lotId } = await harvestWithLot(a.owner, 5)
        const second = await call(api.post(`/vendor/farm/harvests/${harvestId}/lots`, { quantity_total: 7, unit: "lb" }, bearer(a.owner)))
        const secondLotId: string = second.data.lot.id
        const offer = async (id: string) => {
          const res = await call(api.post(`/vendor/farm/lots/${id}/link-product`, { product_id: product.id, unit_price: 2 }, bearer(a.owner)))
          expect({ status: res.status, body: res.data }).toMatchObject({ status: 201 })
          return res.data.availability_window.id as string
        }
        const firstWindow = await offer(lotId)
        const secondWindow = await offer(secondLotId)
        const productLinksOf = async (windowId: string) =>
          (await query().graph({ entity: "product_availability_window", fields: ["availability_window_id"], filters: { availability_window_id: windowId } })).data
        const windowsOf = async (id: string) => (await query().graph({ entity: "availability_window", fields: ["id"], filters: { lot_id: id } })).data
        const harvestLinksOf = async () =>
          (await query().graph({ entity: "producer_harvest", fields: ["harvest_id"], filters: { harvest_id: harvestId } })).data
        expect((await productLinksOf(firstWindow)).length).toBe(1)
        expect((await harvestLinksOf()).length).toBe(1)

        const lotDeleted = await call(api.delete(`/vendor/farm/lots/${lotId}`, bearer(a.member)))
        expect({ status: lotDeleted.status, body: lotDeleted.data, json: String(lotDeleted.headers["content-type"]).includes("application/json") }).toEqual({
          status: 200,
          body: { id: lotId, object: "lot", deleted: true },
          json: true,
        })
        expect((await query().graph({ entity: "lot", fields: ["id"], filters: { id: lotId } })).data).toEqual([])
        expect(await windowsOf(lotId)).toEqual([])
        expect(await productLinksOf(firstWindow)).toEqual([])
        expect((await productLinksOf(secondWindow)).length).toBe(1)

        const harvestDeleted = await call(api.delete(`/vendor/farm/harvests/${harvestId}`, bearer(a.owner)))
        expect({ status: harvestDeleted.status, body: harvestDeleted.data }).toEqual({
          status: 200,
          body: { id: harvestId, object: "harvest", deleted: true },
        })
        expect((await query().graph({ entity: "harvest", fields: ["id"], filters: { id: harvestId } })).data).toEqual([])
        // The database deletes the harvest's lots and their windows
        // (ON DELETE CASCADE); the route dismisses their link rows.
        expect((await query().graph({ entity: "lot", fields: ["id"], filters: { id: secondLotId } })).data).toEqual([])
        expect(await windowsOf(secondLotId)).toEqual([])
        expect(await productLinksOf(secondWindow)).toEqual([])
        expect(await harvestLinksOf()).toEqual([])
      })
    })
  },
})
