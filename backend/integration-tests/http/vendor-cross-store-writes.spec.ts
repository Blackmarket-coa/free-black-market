import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import { NURSERY_VERTICAL_MODULE } from "../../src/modules/nursery-vertical"
import { ORDER_CYCLE_MODULE } from "../../src/modules/order-cycle"
import { assignSellerPlan } from "./helpers/seller-auth"
import { newTestPassword } from "./helpers/test-password"

jest.setTimeout(300 * 1000)

/**
 * One store cannot write another store's records through the nursery and
 * order-cycle routes, on the real server and a migrated database (SD-158).
 *
 * Measured on Postgres before the fix:
 * - POST /vendor/nursery/products found the attribute row by the body's
 *   `product_id` alone and spread the body, `seller_id` included, into the
 *   write. Store B's member posted store A's product with `seller_id` set to B
 *   and got 201 on A's row; the answer carried A's `cost_to_produce`; the row's
 *   `seller_id` became B's and its `hardiness_zone` was overwritten; A no
 *   longer listed it; and B could create a row on another of A's products.
 * - POST /vendor/order-cycles/:id/products took any variant id and updated the
 *   cycle's row for it, whoever owned it: participant B set coordinator A's
 *   row for A's variant to price 0.01, quantity 0 and hidden, and listed
 *   another of A's variants under itself. The exchange-products route did the
 *   same through the service's upsert, and the fees route attached any
 *   store's fee template and answered with it.
 *
 * Stores are made the way approval makes one, with a second member linked to
 * its own member row; tokens carry the claims Medusa mints at sign-in. Every
 * refusal is checked against the rows, not only the status.
 */

const FORBIDDEN = { message: "You do not have access to this record.", type: "not_allowed" }
const invalid = (field: string) => ({ message: `${field} is invalid`, type: "invalid_data" })

medusaIntegrationTestRunner({
  inApp: true,
  env: { FF_NURSERY_VERTICAL_V1: "true" },
  testSuite: ({ api, getContainer }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const container = () => getContainer() as any
    const call = <T = any>(p: Promise<T>) => p.catch((e: any) => e.response)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })
    const pg = () => container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)
    const cycles = () => container().resolve(ORDER_CYCLE_MODULE)
    const nursery = () => container().resolve(NURSERY_VERTICAL_MODULE)

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

    /** A product of the store, linked through `seller_product`, with `variants` variants. */
    async function storeProduct(storeId: string, variants = 1) {
      const sizes = Array.from({ length: variants }, (_, i) => `Size ${i + 1}`)
      const [product] = await container()
        .resolve(Modules.PRODUCT)
        .createProducts([
          {
            title: `Plant ${uid()}`,
            handle: `plant-${uid()}`,
            status: "published",
            options: [{ title: "Size", values: sizes }],
            variants: sizes.map((size) => ({ title: size, options: { Size: size } })),
          },
        ])
      await link().create({ [SELLER_MODULE]: { seller_id: storeId }, [Modules.PRODUCT]: { product_id: product.id } })
      const ids = (product.variants as Array<{ id: string; title: string }>)
        .sort((x, y) => x.title.localeCompare(y.title))
        .map((v) => v.id)
      return { id: product.id as string, variants: ids }
    }

    // ── nursery ──────────────────────────────────────────────────────────
    const attributeRows = async (productId: string) =>
      (
        await pg().raw(
          `SELECT id, seller_id, product_id, subtype::text AS subtype, hardiness_zone, cost_to_produce, tag_data
             FROM nursery_product_attribute WHERE product_id = ? AND deleted_at IS NULL ORDER BY id`,
          [productId]
        )
      ).rows
    const postAttribute = (token: string, body: Record<string, unknown>) => call(api.post("/vendor/nursery/products", body, bearer(token)))
    const listedIds = async (token: string) => {
      const res = await call(api.get("/vendor/nursery/products", bearer(token)))
      expect(res.status).toBe(200)
      return (res.data.attributes as Array<{ id: string }>).map((a) => a.id)
    }

    // ── order cycles ─────────────────────────────────────────────────────
    async function cycleOf(token: string) {
      const res = await call(
        api.post(
          "/vendor/order-cycles",
          { name: `Cycle ${uid()}`, opens_at: new Date(Date.now() - 3600_000).toISOString(), closes_at: new Date(Date.now() + 7 * 86400_000).toISOString() },
          bearer(token)
        )
      )
      expect({ status: res.status, body: res.data }).toMatchObject({ status: 201 })
      return res.data.order_cycle.id as string
    }
    const cycleRows = async (cycleId: string) =>
      (
        await pg().raw(
          `SELECT id, variant_id, seller_id, exchange_id, override_price::text AS override_price, available_quantity, is_visible
             FROM order_cycle_product WHERE order_cycle_id = ? AND deleted_at IS NULL ORDER BY variant_id`,
          [cycleId]
        )
      ).rows
    const addToCycle = (token: string, cycleId: string, body: Record<string, unknown>) =>
      call(api.post(`/vendor/order-cycles/${cycleId}/products`, body, bearer(token)))
    const addToExchange = (token: string, cycleId: string, exchangeId: string, products: unknown) =>
      call(api.post(`/vendor/order-cycles/${cycleId}/exchanges/${exchangeId}/products`, { products }, bearer(token)))
    const removeFromCycle = (token: string, cycleId: string, rowId: string) =>
      call(api.delete(`/vendor/order-cycles/${cycleId}/products/${rowId}`, bearer(token)))

    beforeAll(async () => {
      // A fixture, not FBM's behaviour (SD-63): on a database built from the
      // migrations these tables lack the raw_* companion Medusa writes for
      // their bigNumber field (module-schema-drift.spec.ts lists exactly these
      // two in KNOWN_DRIFT), so every insert and update of a cycle product
      // fails with "column raw_override_price does not exist" and the cycle
      // routes are inert. SD-63's fix adds the columns and arms the routes;
      // this spec checks them as they will be then. Remove when SD-63 merges.
      await pg().raw(`
        ALTER TABLE "order_cycle_product" ADD COLUMN IF NOT EXISTS "raw_override_price" JSONB NULL;
        ALTER TABLE "enterprise_fee" ADD COLUMN IF NOT EXISTS "raw_amount" JSONB NULL;
      `)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    describe("nursery product attributes", () => {
      /** A's product with A's attribute row on it (A's member made it); and B, another store. */
      async function storesWithRow() {
        const a = await team(`Nursery A ${uid()}`)
        const b = await team(`Nursery B ${uid()}`)
        const plant = await storeProduct(a.store.id)
        const created = await postAttribute(a.member, { product_id: plant.id, subtype: "live_plant_1gal", hardiness_zone: "6a", cost_to_produce: 1.25 })
        expect({ status: created.status, seller: created.data?.attribute?.seller_id }).toEqual({ status: 201, seller: a.store.id })
        const rowId: string = created.data.attribute.id
        const before = await attributeRows(plant.id)
        expect(before).toEqual([
          { id: rowId, seller_id: a.store.id, product_id: plant.id, subtype: "live_plant_1gal", hardiness_zone: "6a", cost_to_produce: 1.25, tag_data: null },
        ])
        return { a, b, plant, rowId, before }
      }

      /** What the measured attack left behind: a row with B's seller_id on A's product. */
      async function plantedRow(a: Team, b: Team) {
        const aPlant = await storeProduct(a.store.id)
        const planted = await nursery().createNurseryProductAttributes({
          seller_id: b.store.id,
          product_id: aPlant.id,
          subtype: "seed_packet",
          hardiness_zone: "9b",
          cost_to_produce: 3.5,
          tag_data: { note: "written by B" },
        })
        return { aPlant, rowId: planted.id as string, row: await attributeRows(aPlant.id) }
      }

      it("POST: another store cannot rewrite, re-own or read a store's row, nor make one on its products; seller_id is never the body's", async () => {
        const { a, b, plant, rowId, before } = await storesWithRow()
        const otherPlant = await storeProduct(a.store.id)

        // The measured attack: A's product, B's seller_id in the body.
        const attack = await postAttribute(b.member, { product_id: plant.id, subtype: "seed_packet", hardiness_zone: "9b", seller_id: b.store.id })
        expect({ status: attack.status, body: attack.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect(await attributeRows(plant.id)).toEqual(before)
        expect(await listedIds(a.owner)).toEqual([rowId])
        expect(await listedIds(b.member)).toEqual([])

        // Another of A's products, and a product that does not exist: the same answer, nothing made.
        const onOther = await postAttribute(b.owner, { product_id: otherPlant.id, subtype: "seed_packet" })
        expect({ status: onOther.status, body: onOther.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect(await attributeRows(otherPlant.id)).toEqual([])
        const missingId = `prod_${uid()}`
        const onMissing = await postAttribute(b.owner, { product_id: missingId, subtype: "seed_packet" })
        expect({ status: onMissing.status, body: onMissing.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect(await attributeRows(missingId)).toEqual([])

        // A's other member: the upsert updates the same row with the fields
        // sent, and a seller_id in the body is not read.
        const upsert = await postAttribute(a.owner, { product_id: plant.id, subtype: "live_plant_3gal", seller_id: b.store.id })
        expect({ status: upsert.status, id: upsert.data?.attribute?.id }).toEqual({ status: 201, id: rowId })
        expect(await attributeRows(plant.id)).toEqual([{ ...before[0], subtype: "live_plant_3gal" }])

        // B's own product: the row is B's, whatever seller_id the body names.
        const bPlant = await storeProduct(b.store.id)
        const bRow = await postAttribute(b.member, { product_id: bPlant.id, subtype: "seed_packet", seller_id: a.store.id })
        expect({ status: bRow.status, seller: bRow.data?.attribute?.seller_id }).toEqual({ status: 201, seller: b.store.id })
        expect(await listedIds(b.owner)).toEqual([bRow.data.attribute.id])
      })

      it("PUT and DELETE by id: another store's row and a missing id get the same 403; the store's own PUT writes attribute columns only", async () => {
        const { a, b, plant, rowId, before } = await storesWithRow()
        const otherPlant = await storeProduct(a.store.id)

        const put = await call(api.put(`/vendor/nursery/products/${rowId}`, { hardiness_zone: "9b" }, bearer(b.member)))
        expect({ status: put.status, body: put.data }).toEqual({ status: 403, body: FORBIDDEN })
        const del = await call(api.delete(`/vendor/nursery/products/${rowId}`, bearer(b.owner)))
        expect({ status: del.status, body: del.data }).toEqual({ status: 403, body: FORBIDDEN })
        const putMissing = await call(api.put(`/vendor/nursery/products/npa_${uid()}`, { hardiness_zone: "9b" }, bearer(b.member)))
        expect({ status: putMissing.status, body: putMissing.data }).toEqual({ status: 403, body: FORBIDDEN })
        const delMissing = await call(api.delete(`/vendor/nursery/products/npa_${uid()}`, bearer(b.member)))
        expect({ status: delMissing.status, body: delMissing.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect(await attributeRows(plant.id)).toEqual(before)

        // PUT writes the attribute columns only, never seller_id or product_id.
        const ownPut = await call(api.put(`/vendor/nursery/products/${rowId}`, { cost_to_produce: 2, seller_id: b.store.id, product_id: otherPlant.id }, bearer(a.member)))
        expect({ status: ownPut.status, cost: ownPut.data?.attribute?.cost_to_produce }).toEqual({ status: 200, cost: 2 })
        expect(await attributeRows(plant.id)).toEqual([{ ...before[0], cost_to_produce: 2 }])
        expect(await attributeRows(otherPlant.id)).toEqual([])

        const ownDelete = await call(api.delete(`/vendor/nursery/products/${rowId}`, bearer(a.owner)))
        expect({ status: ownDelete.status, body: ownDelete.data }).toEqual({ status: 200, body: { id: rowId, deleted: true } })
        expect(await attributeRows(plant.id)).toEqual([])
      })

      it("an id must be one string: query.graph reads an array in a filter as IN", async () => {
        const a = await team(`Nursery C ${uid()}`)
        const b = await team(`Nursery D ${uid()}`)
        const bPlant = await storeProduct(b.store.id)
        const aPlant = await storeProduct(a.store.id)
        for (const product_id of [[bPlant.id, aPlant.id], [bPlant.id]]) {
          const res = await postAttribute(b.member, { product_id, subtype: "seed_packet" })
          expect({ status: res.status, body: res.data }).toEqual({ status: 400, body: invalid("product_id") })
        }
        expect(await attributeRows(bPlant.id)).toEqual([])
        expect(await attributeRows(aPlant.id)).toEqual([])
      })

      it("a row B wrote on A's product before the fix is not B's to list, change or remove, nor A's to edit in place", async () => {
        const a = await team(`Nursery E ${uid()}`)
        const b = await team(`Nursery F ${uid()}`)
        const { aPlant, rowId, row } = await plantedRow(a, b)

        expect(await listedIds(b.member)).toEqual([])
        const put = await call(api.put(`/vendor/nursery/products/${rowId}`, { hardiness_zone: "4a" }, bearer(b.member)))
        expect({ status: put.status, body: put.data }).toEqual({ status: 403, body: FORBIDDEN })
        const del = await call(api.delete(`/vendor/nursery/products/${rowId}`, bearer(b.owner)))
        expect({ status: del.status, body: del.data }).toEqual({ status: 403, body: FORBIDDEN })
        // Nor can A edit it in place and read back what B wrote: A takes it over with a POST.
        const aPut = await call(api.put(`/vendor/nursery/products/${rowId}`, { hardiness_zone: "4a" }, bearer(a.member)))
        expect({ status: aPut.status, body: aPut.data }).toEqual({ status: 403, body: FORBIDDEN })
        const aDel = await call(api.delete(`/vendor/nursery/products/${rowId}`, bearer(a.owner)))
        expect({ status: aDel.status, body: aDel.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect(await listedIds(a.owner)).toEqual([])
        expect(await attributeRows(aPlant.id)).toEqual(row)
      })

      it("A's own POST takes such a row over: A's seller_id, the fields A sent, and nothing B wrote", async () => {
        const a = await team(`Nursery G ${uid()}`)
        const b = await team(`Nursery H ${uid()}`)
        const { aPlant, rowId } = await plantedRow(a, b)

        const takeover = await postAttribute(a.member, { product_id: aPlant.id, subtype: "live_plant_liner", hardiness_zone: "5b" })
        expect({ status: takeover.status, id: takeover.data?.attribute?.id }).toEqual({ status: 201, id: rowId })
        expect(await attributeRows(aPlant.id)).toEqual([
          { id: rowId, seller_id: a.store.id, product_id: aPlant.id, subtype: "live_plant_liner", hardiness_zone: "5b", cost_to_produce: null, tag_data: null },
        ])
        expect(JSON.stringify(takeover.data)).not.toContain("written by B")
        expect(await listedIds(a.owner)).toEqual([rowId])
      })
    })

    describe("order cycle products", () => {
      /** Coordinator A's cycle with participant B, and A's variant listed at price 5, quantity 10. */
      async function cycleWithListing(variants = 2) {
        const a = await team(`Hub A ${uid()}`)
        const b = await team(`Grower B ${uid()}`)
        const aProduct = await storeProduct(a.store.id, variants)
        const bProduct = await storeProduct(b.store.id, 2)
        const cycleId = await cycleOf(a.member)
        await cycles().addSellerToOrderCycle(cycleId, b.store.id, "producer")
        const listed = await addToCycle(a.member, cycleId, { variant_id: aProduct.variants[0], override_price: 5, available_quantity: 10 })
        expect({ status: listed.status, seller: listed.data?.product?.seller_id }).toEqual({ status: 201, seller: a.store.id })
        const aRowId: string = listed.data.product.id
        const before = await cycleRows(cycleId)
        expect(before).toEqual([
          { id: aRowId, variant_id: aProduct.variants[0], seller_id: a.store.id, exchange_id: null, override_price: "5", available_quantity: 10, is_visible: true },
        ])
        return { a, b, aProduct, bProduct, cycleId, aRowId, before }
      }
      const byVariant = (rows: Array<{ variant_id: string }>) => [...rows].sort((x, y) => x.variant_id.localeCompare(y.variant_id))

      it("POST: a participant cannot reprice, empty or hide the coordinator's listing, nor list its variants; nor can the coordinator set the participant's", async () => {
        const { a, b, aProduct, bProduct, cycleId, before } = await cycleWithListing()
        const c = await team(`Outsider C ${uid()}`)
        const cProduct = await storeProduct(c.store.id)

        // The measured attack, and A's other variant listed under B.
        const attack = await addToCycle(b.member, cycleId, { variant_id: aProduct.variants[0], override_price: 0.01, available_quantity: 0, is_visible: false })
        expect({ status: attack.status, body: attack.data }).toEqual({ status: 403, body: FORBIDDEN })
        const underB = await addToCycle(b.owner, cycleId, { variant_id: aProduct.variants[1] })
        expect({ status: underB.status, body: underB.data }).toEqual({ status: 403, body: FORBIDDEN })
        const missing = await addToCycle(b.owner, cycleId, { variant_id: `variant_${uid()}` })
        expect({ status: missing.status, body: missing.data }).toEqual({ status: 403, body: FORBIDDEN })
        const asArray = await addToCycle(b.member, cycleId, { variant_id: [bProduct.variants[0], aProduct.variants[0]] })
        expect({ status: asArray.status, body: asArray.data }).toEqual({ status: 400, body: invalid("variant_id") })
        const outsider = await addToCycle(c.member, cycleId, { variant_id: cProduct.variants[0] })
        expect(outsider.status).toBe(403)
        expect(await cycleRows(cycleId)).toEqual(before)

        // B lists its own variant and changes its own row.
        const own = await addToCycle(b.member, cycleId, { variant_id: bProduct.variants[0], override_price: 3 })
        expect({ status: own.status, seller: own.data?.product?.seller_id }).toEqual({ status: 201, seller: b.store.id })
        const bRowId: string = own.data.product.id
        const again = await addToCycle(b.owner, cycleId, { variant_id: bProduct.variants[0], override_price: 4, available_quantity: 2 })
        expect({ status: again.status, id: again.data?.product?.id }).toEqual({ status: 201, id: bRowId })
        const bRow = { id: bRowId, variant_id: bProduct.variants[0], seller_id: b.store.id, exchange_id: null, override_price: "4", available_quantity: 2, is_visible: true }
        expect(await cycleRows(cycleId)).toEqual(byVariant([...before, bRow]))

        // The coordinator may not set the participant's price (own rows only).
        const coordinator = await addToCycle(a.owner, cycleId, { variant_id: bProduct.variants[0], override_price: 0.01, is_visible: false })
        expect({ status: coordinator.status, body: coordinator.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect(await cycleRows(cycleId)).toEqual(byVariant([...before, bRow]))
      })

      it("DELETE: a participant cannot remove another store's row; a missing row and another cycle's get the same 403; the coordinator removes any row", async () => {
        const { a, b, bProduct, cycleId, aRowId, before } = await cycleWithListing()
        const own = await addToCycle(b.member, cycleId, { variant_id: bProduct.variants[0] })
        const own2 = await addToCycle(b.member, cycleId, { variant_id: bProduct.variants[1] })
        expect([own.status, own2.status]).toEqual([201, 201])
        const ids = async () => (await cycleRows(cycleId)).map((r: { id: string }) => r.id).sort()
        const all = [aRowId, own.data.product.id, own2.data.product.id].sort()

        const bRemoves = await removeFromCycle(b.member, cycleId, aRowId)
        expect({ status: bRemoves.status, body: bRemoves.data }).toEqual({ status: 403, body: FORBIDDEN })
        const removesMissing = await removeFromCycle(b.member, cycleId, `ocp_${uid()}`)
        expect({ status: removesMissing.status, body: removesMissing.data }).toEqual({ status: 403, body: FORBIDDEN })
        const otherCycleId = await cycleOf(a.owner)
        const throughOther = await removeFromCycle(a.owner, otherCycleId, aRowId)
        expect({ status: throughOther.status, body: throughOther.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect(await ids()).toEqual(all)

        // B removes its own row; the coordinator removes B's other one.
        const bRemovesOwn = await removeFromCycle(b.owner, cycleId, own.data.product.id)
        expect({ status: bRemovesOwn.status, body: bRemovesOwn.data }).toEqual({ status: 200, body: { success: true } })
        const coordinatorRemoves = await removeFromCycle(a.member, cycleId, own2.data.product.id)
        expect({ status: coordinatorRemoves.status, body: coordinatorRemoves.data }).toEqual({ status: 200, body: { success: true } })
        expect(await cycleRows(cycleId)).toEqual(before)
      })

      it("exchange products are the exchange owner's own variants on its own exchange", async () => {
        const { a, b, aProduct, bProduct, cycleId, before } = await cycleWithListing()
        // What the coalition launch makes for a participant: an incoming exchange.
        const bExchange = await cycles().createIncomingExchange(cycleId, b.store.id, a.store.id)
        const aExchangeRes = await call(api.post(`/vendor/order-cycles/${cycleId}/exchanges`, { exchange_type: "outgoing" }, bearer(a.member)))
        expect(aExchangeRes.status).toBe(201)
        const aExchangeId: string = aExchangeRes.data.exchange.id

        // B's exchange, A's variant: A's row is not moved or rewritten; a
        // request that mixes B's variant with A's writes nothing.
        const attack = await addToExchange(b.member, cycleId, bExchange.id, [{ variant_id: aProduct.variants[0], override_price: 0.01, available_quantity: 0 }])
        expect({ status: attack.status, body: attack.data }).toEqual({ status: 403, body: FORBIDDEN })
        const mixed = await addToExchange(b.owner, cycleId, bExchange.id, [{ variant_id: bProduct.variants[0] }, { variant_id: aProduct.variants[1] }])
        expect({ status: mixed.status, body: mixed.data }).toEqual({ status: 403, body: FORBIDDEN })
        const asArray = await addToExchange(b.owner, cycleId, bExchange.id, [{ variant_id: [bProduct.variants[0], aProduct.variants[0]] }])
        expect({ status: asArray.status, body: asArray.data }).toEqual({ status: 400, body: invalid("products[0].variant_id") })
        expect(await cycleRows(cycleId)).toEqual(before)

        // B's own variant on its own exchange.
        const own = await addToExchange(b.member, cycleId, bExchange.id, [{ variant_id: bProduct.variants[0], override_price: 3 }])
        expect({ status: own.status, seller: own.data?.products?.[0]?.seller_id }).toEqual({ status: 201, seller: b.store.id })
        const afterOwn = await cycleRows(cycleId)
        expect(afterOwn.find((r: { variant_id: string }) => r.variant_id === bProduct.variants[0])).toMatchObject({
          seller_id: b.store.id,
          exchange_id: bExchange.id,
          override_price: "3",
        })

        // The coordinator writes no rows on B's exchange: not with B's
        // variant, and not with its own.
        const coordinator = await addToExchange(a.owner, cycleId, bExchange.id, [{ variant_id: bProduct.variants[0], override_price: 0.01 }])
        expect({ status: coordinator.status, body: coordinator.data }).toEqual({ status: 403, body: FORBIDDEN })
        const coordinatorOwn = await addToExchange(a.member, cycleId, bExchange.id, [{ variant_id: aProduct.variants[1] }])
        expect({ status: coordinatorOwn.status, body: coordinatorOwn.data }).toEqual({ status: 403, body: FORBIDDEN })
        expect(await cycleRows(cycleId)).toEqual(afterOwn)

        // The coordinator moves its own row onto its own exchange.
        const moved = await addToExchange(a.member, cycleId, aExchangeId, [{ variant_id: aProduct.variants[0], override_price: 6 }])
        expect({ status: moved.status, id: moved.data?.products?.[0]?.id }).toEqual({ status: 201, id: before[0].id })
        expect((await cycleRows(cycleId)).find((r: { id: string }) => r.id === before[0].id)).toMatchObject({
          seller_id: a.store.id,
          exchange_id: aExchangeId,
          override_price: "6",
          available_quantity: 10,
        })
      })

      it("the store's variant listed in the cycle under another store (before the fix) is 409 on both routes, and that row is left alone", async () => {
        const { a, b, aProduct, cycleId } = await cycleWithListing(3)
        const aExchangeRes = await call(api.post(`/vendor/order-cycles/${cycleId}/exchanges`, { exchange_type: "outgoing" }, bearer(a.member)))
        const aExchangeId: string = aExchangeRes.data.exchange.id
        const held = await cycles().createOrderCycleProducts({
          order_cycle_id: cycleId,
          variant_id: aProduct.variants[2],
          seller_id: b.store.id,
          override_price: 1,
        })
        const beforeConflict = await cycleRows(cycleId)
        expect(beforeConflict.find((r: { id: string }) => r.id === held.id)).toMatchObject({ seller_id: b.store.id, override_price: "1" })

        const viaCycle = await addToCycle(a.member, cycleId, { variant_id: aProduct.variants[2], override_price: 9 })
        expect({ status: viaCycle.status, body: viaCycle.data }).toEqual({
          status: 409,
          body: { message: "Another store already lists this variant in this order cycle" },
        })
        expect(await cycleRows(cycleId)).toEqual(beforeConflict)
        const viaExchange = await addToExchange(a.member, cycleId, aExchangeId, [{ variant_id: aProduct.variants[2], override_price: 9 }])
        expect({ status: viaExchange.status, body: viaExchange.data }).toEqual({
          status: 409,
          body: { message: "Another store already lists one of these variants in this order cycle" },
        })
        expect(await cycleRows(cycleId)).toEqual(beforeConflict)
      })

      it("a failed write answers what failed, never the database's text", async () => {
        const a = await team(`Hub G ${uid()}`)
        const aProduct = await storeProduct(a.store.id)
        const cycleId = await cycleOf(a.member)
        const exchange = await call(api.post(`/vendor/order-cycles/${cycleId}/exchanges`, { exchange_type: "outgoing" }, bearer(a.member)))
        const sqlError = () =>
          new Error('insert into "order_cycle_product" ("id") values ($1) - column "raw_override_price" of relation "order_cycle_product" does not exist')

        const create = jest.spyOn(cycles(), "createOrderCycleProducts").mockRejectedValueOnce(sqlError())
        const viaCycle = await addToCycle(a.member, cycleId, { variant_id: aProduct.variants[0] })
        expect({ status: viaCycle.status, body: viaCycle.data }).toEqual({ status: 500, body: { message: "Failed to add product to order cycle" } })
        create.mockRejectedValueOnce(sqlError())
        const viaExchange = await addToExchange(a.member, cycleId, exchange.data.exchange.id, [{ variant_id: aProduct.variants[0] }])
        expect({ status: viaExchange.status, body: viaExchange.data }).toEqual({ status: 500, body: { message: "Failed to add products" } })
        // The route's own write was the one refused, both times.
        expect(create).toHaveBeenCalledTimes(2)
        expect(await cycleRows(cycleId)).toEqual([])
      })
    })

    describe("order cycle fees", () => {
      it("the coordinator applies only its own fee templates, and another store's is never read back", async () => {
        const a = await team(`Hub H ${uid()}`)
        const b = await team(`Store I ${uid()}`)
        const cycleId = await cycleOf(a.member)
        const aFee = await cycles().createFeeTemplate(a.store.id, { name: "Hub packing", fee_type: "packing", calculator_type: "flat_rate", amount: 150 })
        const bFee = await cycles().createFeeTemplate(b.store.id, { name: "Private markup", fee_type: "sales", calculator_type: "percentage", amount: 777 })
        const feeRows = async () =>
          (await pg().raw(`SELECT enterprise_fee_id FROM order_cycle_fee WHERE order_cycle_id = ? AND deleted_at IS NULL ORDER BY created_at`, [cycleId])).rows.map(
            (r: { enterprise_fee_id: string }) => r.enterprise_fee_id
          )
        const apply = (body: Record<string, unknown>) => call(api.post(`/vendor/order-cycles/${cycleId}/fees`, body, bearer(a.member)))

        const theirs = await apply({ enterprise_fee_id: bFee.id, application_type: "coordinator" })
        expect({ status: theirs.status, body: theirs.data }).toEqual({ status: 403, body: FORBIDDEN })
        const missing = await apply({ enterprise_fee_id: `ef_${uid()}`, application_type: "coordinator" })
        expect({ status: missing.status, body: missing.data }).toEqual({ status: 403, body: FORBIDDEN })
        const asArray = await apply({ enterprise_fee_id: [aFee.id, bFee.id], application_type: "coordinator" })
        expect({ status: asArray.status, body: asArray.data }).toEqual({ status: 400, body: invalid("enterprise_fee_id") })
        expect(await feeRows()).toEqual([])

        const own = await apply({ enterprise_fee_id: aFee.id, application_type: "coordinator" })
        expect({ status: own.status, template: own.data?.fee?.enterprise_fee?.name }).toEqual({ status: 201, template: "Hub packing" })
        expect(await feeRows()).toEqual([aFee.id])

        // A fee that names B's template, attached before the POST checked:
        // listed, without B's template.
        await cycles().createOrderCycleFees({ order_cycle_id: cycleId, enterprise_fee_id: bFee.id, application_type: "coordinator" })
        const listed = await call(api.get(`/vendor/order-cycles/${cycleId}/fees`, bearer(a.owner)))
        expect(listed.status).toBe(200)
        const byTemplate = new Map((listed.data.fees as Array<{ enterprise_fee_id: string; enterprise_fee?: { name: string } }>).map((f) => [f.enterprise_fee_id, f]))
        expect(byTemplate.get(aFee.id)?.enterprise_fee?.name).toBe("Hub packing")
        expect(byTemplate.get(bFee.id)).toBeDefined()
        expect(byTemplate.get(bFee.id)?.enterprise_fee).toBeUndefined()
        expect(JSON.stringify(listed.data)).not.toContain("Private markup")
      })
    })
  },
})
