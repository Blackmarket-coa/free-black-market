import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import jwt from "jsonwebtoken"
import { createPublishableKeyToken } from "./_publishable-key"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"
import type { AuthenticatedSeller } from "./helpers/seller-auth"
import { FOOD_DISTRIBUTION_MODULE } from "../../src/modules/food-distribution"
import { FoodOrderStatus, TransactionType } from "../../src/modules/food-distribution/models/food-order"

jest.setTimeout(180 * 1000)

/**
 * What the review of the courier leak fix left open (SD-110 (i) to (iii)),
 * and the two food-network 500s recorded beside it (SD-119 (1), (2)), against
 * a migrated database and the real middleware stack.
 *
 *  1. A seller is the owner on a read as on a write. The framework identifies
 *     customers on /store, the community-write matchers admit a seller or a
 *     driver on the write verbs only, so a seller who registered a courier
 *     was refused its shifts and its deliveries. And the public catalogue
 *     reads under the same prefixes answer a caller with no account, or with
 *     a token that is forged or expired, exactly as they did.
 *  2. `POST /vendor/deliveries/:id` on a delivery made the way
 *     `POST /store/food-deliveries` makes it (500 "existingHistory is not
 *     iterable"), and on a row that already holds the list it used to write.
 *  3. A signed-in stranger on a courier, a batch and a producer with no owner
 *     on record: the claim and the batch PUT were that account's read of
 *     deliveries it is refused on GET; a shift told it when the courier is
 *     out, an added delivery how many the run holds, and the producer PUT
 *     the address `hide_address` keeps off the GET (the review of this
 *     branch found those three).
 *
 * These are in a file of their own, not in
 * `store-food-network-write-authz.spec.ts`: that one already spends 13 of the
 * 20 requests a minute the auth rate limit allows one address, and the three
 * sellers and one customer here are nine more. The limiter's store is in
 * memory, per spec file.
 *
 * The same rules on fake containers: `src/api/__tests__/food-network-owner-read-auth.unit.spec.ts`,
 * `src/api/store/couriers/__tests__/courier-read-projection.unit.spec.ts`,
 * `src/api/store/delivery-batches/__tests__/batch-entitlement.unit.spec.ts`,
 * `src/api/store/food-producers/__tests__/producer-write-echo.unit.spec.ts`,
 * `src/api/vendor/deliveries/__tests__/delivery-refusal.unit.spec.ts` and
 * `src/modules/food-distribution/__tests__/status-history.unit.spec.ts`.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const refusal = { message: "You do not have access to this record.", type: "not_allowed" }
    const flipLast = (id: string) => `${id.slice(0, -1)}${id.endsWith("0") ? "1" : "0"}`

    // A delivery to someone's home, with values nothing else here holds.
    const HOME = {
      delivery_address: "14 Orchard Lane",
      delivery_instructions: "gate code 7731",
      recipient_name: "Rita Okafor",
      recipient_phone: "+15550199",
      proof_pin_code: "6042817395",
    }
    const expectNothingOfDelivery = (who: string, body: unknown, ids: string[]) => {
      const text = JSON.stringify(body)
      for (const value of [...ids, ...Object.values(HOME)]) {
        expect([who, value, text.includes(value)]).toEqual([who, value, false])
      }
    }

    const savedPickPack = process.env.FF_PICK_PACK_V1
    afterEach(() => {
      if (savedPickPack === undefined) delete process.env.FF_PICK_PACK_V1
      else process.env.FF_PICK_PACK_V1 = savedPickPack
    })

    const producerFor = (foodDistribution: any, fields: Record<string, unknown>) =>
      foodDistribution.createFoodProducers({
        name: "Kitchen",
        handle: `kitchen-${uid()}`,
        email: `kitchen-${uid()}@example.com`,
        ...fields,
      })
    const homeOrder = (foodDistribution: any, producerId: string, fields: Record<string, unknown> = {}) =>
      foodDistribution.createFoodOrders({
        order_number: `FO-${uid()}`,
        transaction_type: TransactionType.SALE,
        producer_id: producerId,
        recipient_name: HOME.recipient_name,
        recipient_phone: HOME.recipient_phone,
        delivery_address_line_1: HOME.delivery_address,
        items: {},
        ordered_at: new Date(),
        status: FoodOrderStatus.PENDING,
        ...fields,
      })
    // One shift, and a window inside it and one clear of it.
    const SHIFT = { scheduled_start: "2026-12-01T09:00:00.000Z", scheduled_end: "2026-12-01T17:00:00.000Z" }
    const INSIDE_IT = { scheduled_start: "2026-12-01T10:00:00.000Z", scheduled_end: "2026-12-01T11:00:00.000Z" }
    const CLEAR_OF_IT = { scheduled_start: "2026-12-03T10:00:00.000Z", scheduled_end: "2026-12-03T11:00:00.000Z" }

    it("a seller reads the courier, the deliveries, the orders and the batches they own, and the public reads are as they were", async () => {
      const pak = await createPublishableKeyToken(getContainer)
      const owner = await createAuthenticatedSeller({ api, getContainer })
      const other = await createAuthenticatedSeller({ api, getContainer })
      const foodDistribution = getContainer().resolve(FOOD_DISTRIBUTION_MODULE)
      const withToken = (token: string) => ({
        headers: { authorization: `Bearer ${token}`, "x-publishable-api-key": pak },
      })
      const as = (seller: AuthenticatedSeller) => withToken(seller.token)
      const anonymous = { headers: { "x-publishable-api-key": pak } }

      // Tokens that must identify nobody. `minted` is the control: the same
      // claims, signed with the server's secret and not expired, are the
      // owner; so the two beside it are refused for the reason named.
      const claims = {
        actor_id: owner.actorId,
        actor_type: "seller",
        auth_identity_id: owner.authIdentityId,
        app_metadata: { seller_id: owner.actorId },
      }
      const secret = process.env.JWT_SECRET as string
      expect(typeof secret).toBe("string")
      const minted = withToken(jwt.sign(claims, secret, { expiresIn: "1h" }))
      const UNIDENTIFIED = [
        ["no token", anonymous],
        ["a token that is not one", withToken("not.a.jwt")],
        ["an expired token", withToken(jwt.sign(claims, secret, { expiresIn: -60 }))],
        ["a token signed with another secret", withToken(jwt.sign(claims, `${secret}-not`, { expiresIn: "1h" }))],
      ] as const

      // POST /store/couriers. `phone` was optional in the schema and is NOT
      // NULL in the table: a create without it answered 500.
      const courierBody = {
        email: `seller-courier-${uid()}@example.com`,
        first_name: "Sel",
        last_name: "Ler",
        courier_type: "INDEPENDENT",
        vehicle_type: "BIKE",
      }
      const noPhone = await safe(api.post("/store/couriers", courierBody, as(owner)))
      expect([noPhone.status, noPhone.data?.message]).toEqual([400, "Validation failed"])
      expect((noPhone.data.errors as Array<{ path: string[] }>).map((issue) => issue.path.join("."))).toEqual(["phone"])
      expect(await foodDistribution.listCouriers({ email: courierBody.email })).toHaveLength(0)
      const registered = await safe(api.post("/store/couriers", { ...courierBody, phone: "5550111" }, as(owner)))
      expect([registered.status, registered.data?.courier?.owner_type, registered.data?.courier?.owner_id]).toEqual([
        201,
        "seller",
        owner.actorId,
      ])
      const courierId = registered.data.courier.id as string

      // Its shifts: the seller created one (201) and was then refused the
      // list (403), as everyone was.
      const shift = await safe(
        api.post(
          `/store/couriers/${courierId}/shifts`,
          { ...SHIFT, notes: "home by 5" },
          as(owner)
        )
      )
      expect(shift.status).toBe(201)
      // The owner is still told when a second one would overlap it.
      const doubleBooked = await safe(api.post(`/store/couriers/${courierId}/shifts`, INSIDE_IT, as(owner)))
      expect([doubleBooked.status, doubleBooked.data]).toEqual([400, { message: "Shift overlaps with existing shift" }])
      const ownShifts = await safe(api.get(`/store/couriers/${courierId}/shifts`, as(owner)))
      expect([ownShifts.status, ownShifts.data?.shifts?.map((row: { id: string }) => row.id)]).toEqual([
        200,
        [shift.data.shift.id],
      ])
      expect((await safe(api.get(`/store/couriers/${courierId}/shifts`, minted))).status).toBe(200)
      const othersShifts = await safe(api.get(`/store/couriers/${courierId}/shifts`, as(other)))
      expect([othersShifts.status, othersShifts.data]).toEqual([403, refusal])
      for (const [who, caller] of UNIDENTIFIED) {
        // Refused by the handler, as nobody: not turned into a 401.
        const read = await safe(api.get(`/store/couriers/${courierId}/shifts`, caller))
        expect([who, read.status, read.data]).toEqual([who, 403, refusal])
      }

      // The seller's producer, an order on it, and its delivery made the way
      // POST /store/food-deliveries makes one. The seller's courier claims it.
      const producer = await producerFor(foodDistribution, { owner_id: owner.actorId })
      const order = await homeOrder(foodDistribution, producer.id)
      const made = await safe(
        api.post(
          "/store/food-deliveries",
          { order_id: order.id, pickup_address: "1 Kitchen Way", proof_type: "PIN_CODE", ...HOME },
          as(owner)
        )
      )
      expect(made.status).toBe(201)
      const deliveryId = made.data.delivery.id as string
      expect((await safe(api.put(`/store/couriers/${courierId}`, { status: "AVAILABLE" }, as(owner)))).status).toBe(200)
      const claimed = await safe(api.post(`/store/couriers/${courierId}`, { delivery_id: deliveryId }, as(owner)))
      expect([claimed.status, claimed.data?.delivery?.id]).toEqual([200, deliveryId])

      // The courier read: its owner gets the row and the delivery it is
      // carrying (without the PIN); the seller was given the stranger's view.
      const ownCourier = await safe(api.get(`/store/couriers/${courierId}`, as(owner)))
      expect([ownCourier.status, ownCourier.data?.courier?.email, ownCourier.data?.courier?.active_delivery_count]).toEqual([
        200,
        courierBody.email,
        1,
      ])
      const carrying = ownCourier.data.courier.active_deliveries as Array<Record<string, unknown>>
      expect(carrying).toHaveLength(1)
      expect(carrying[0]).toMatchObject({ id: deliveryId, delivery_address: HOME.delivery_address })
      expect(carrying[0]).not.toHaveProperty("proof_pin_code")
      for (const [who, caller] of [["another seller", as(other)], ...UNIDENTIFIED] as const) {
        const read = await safe(api.get(`/store/couriers/${courierId}`, caller))
        expect([who, read.status, read.data?.courier?.active_delivery_count]).toEqual([who, 200, 1])
        expect(read.data.courier).not.toHaveProperty("active_deliveries")
        expect(read.data.courier).not.toHaveProperty("email")
        expectNothingOfDelivery(who, read.data, [deliveryId, order.id])
      }

      // The delivery, the producer's board and its orders: the owner's, and
      // nobody else's because a seller is now identified.
      const OWNER_READS = [
        `/store/food-deliveries/${deliveryId}`,
        `/store/food-deliveries/${deliveryId}/track`,
        `/store/food-deliveries?producer_id=${producer.id}`,
        `/store/food-deliveries?courier_id=${courierId}`,
        `/store/food-producers/${producer.id}/orders`,
        `/store/food-producers/${producer.id}/orders/${order.id}`,
        `/store/food-trades?producer_id=${producer.id}`,
        `/store/food-donations?producer_id=${producer.id}`,
      ]
      for (const url of OWNER_READS) {
        const own = await safe(api.get(url, as(owner)))
        expect([url, own.status]).toEqual([url, 200])
        expect(JSON.stringify(own.data)).not.toContain(HOME.proof_pin_code)
        for (const [who, caller] of [["another seller", as(other)], ...UNIDENTIFIED] as const) {
          const read = await safe(api.get(url, caller))
          expect([url, who, read.status]).toEqual([url, who, 403])
          expectNothingOfDelivery(`${who} ${url}`, read.data, [deliveryId, order.id])
        }
      }
      const board = await safe(api.get(`/store/food-deliveries?producer_id=${producer.id}`, as(owner)))
      expect(board.data.deliveries.map((row: { id: string }) => row.id)).toEqual([deliveryId])
      const orders = await safe(api.get(`/store/food-producers/${producer.id}/orders`, as(owner)))
      expect(orders.data.orders.map((row: { id: string }) => row.id)).toEqual([order.id])

      // The public catalogue under the same prefixes: the same answer for a
      // caller with no account as for one whose token identifies nobody,
      // and never a 401.
      for (const url of [
        "/store/couriers?limit=100",
        `/store/couriers/${courierId}`,
        "/store/food-producers?limit=100",
        `/store/food-producers/${producer.id}`,
      ]) {
        const open = await safe(api.get(url, anonymous))
        expect([url, open.status]).toEqual([url, 200])
        for (const [who, caller] of UNIDENTIFIED) {
          const read = await safe(api.get(url, caller))
          expect([url, who, read.status]).toEqual([url, who, 200])
          expect([url, who, read.data]).toEqual([url, who, open.data])
        }
      }
      // And a write still needs an account: an expired token is a 401 there.
      const expiredWrite = await safe(
        api.put(`/store/couriers/${courierId}`, { status: "OFFLINE" }, UNIDENTIFIED[2][1])
      )
      expect(expiredWrite.status).toBe(401)
      expect((await foodDistribution.retrieveCourier(courierId)).status).toBe("ON_DELIVERY")

      // Batches, behind FF_PICK_PACK_V1: the seller plans one and is served
      // it by the list and the read. The delivery is named twice: it is one
      // delivery, and the batch was created counting two.
      process.env.FF_PICK_PACK_V1 = "true"
      const planned = await safe(
        api.post("/store/delivery-batches", { delivery_ids: [deliveryId, deliveryId] }, as(owner))
      )
      expect([planned.status, planned.data?.batch?.owner_id, planned.data?.batch?.total_deliveries]).toEqual([
        201,
        owner.actorId,
        1,
      ])
      const batchId = planned.data.batch.id as string
      expect(planned.data.batch.deliveries.map((row: { id: string }) => row.id)).toEqual([deliveryId])
      const batched = await foodDistribution.retrieveFoodDelivery(deliveryId)
      expect([batched.batch_id, batched.batch_sequence]).toEqual([batchId, 1])
      const batchIds = (answer: { data?: { batches?: Array<{ id: string }> } }) =>
        (answer.data?.batches ?? []).map((row) => row.id)
      const ownBatches = await safe(api.get("/store/delivery-batches", as(owner)))
      expect([ownBatches.status, batchIds(ownBatches), ownBatches.data?.count]).toEqual([200, [batchId], 1])
      const ownBatch = await safe(api.get(`/store/delivery-batches/${batchId}`, as(owner)))
      expect([ownBatch.status, ownBatch.data?.batch?.deliveries?.map((row: { id: string }) => row.id)]).toEqual([
        200,
        [deliveryId],
      ])
      const othersBatches = await safe(api.get("/store/delivery-batches", as(other)))
      expect([othersBatches.status, batchIds(othersBatches)]).toEqual([200, []])
      const othersBatch = await safe(api.get(`/store/delivery-batches/${batchId}`, as(other)))
      expect([othersBatch.status, othersBatch.data]).toEqual([403, refusal])
      for (const [who, caller] of UNIDENTIFIED) {
        for (const url of ["/store/delivery-batches", `/store/delivery-batches/${batchId}`]) {
          const read = await safe(api.get(url, caller))
          expect([who, url, read.status, read.data]).toEqual([who, url, 403, refusal])
        }
      }
      // Adding it again, twice in one request, is refused as already there
      // and changes nothing; a second delivery named twice takes one place.
      const second = await foodDistribution.createDeliveryForOrder((await homeOrder(foodDistribution, producer.id)).id, {
        pickup_address: "1 Kitchen Way",
        delivery_address: "8 Mill Road",
        recipient_name: "Second",
      })
      const added = await safe(
        api.post(`/store/delivery-batches/${batchId}`, { delivery_ids: [second.id, second.id] }, as(owner))
      )
      expect([added.status, added.data]).toEqual([200, { success: true, total_deliveries: 2 }])
      expect((await foodDistribution.retrieveFoodDelivery(second.id)).batch_sequence).toBe(2)
      expect((await foodDistribution.retrieveDeliveryBatch(batchId)).total_deliveries).toBe(2)
    })

    it("the vendor's status update goes through the service, on the shape the service stores and on a list left by the old route", async () => {
      const pak = await createPublishableKeyToken(getContainer)
      const vendor = await createAuthenticatedSeller({ api, getContainer })
      const foodDistribution = getContainer().resolve(FOOD_DISTRIBUTION_MODULE)
      const pg = getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const store = { headers: { authorization: `Bearer ${vendor.token}`, "x-publishable-api-key": pak } }
      const panel = authHeader(vendor.token)

      // The vendor's producer: `seller_id` is what /vendor/deliveries keys
      // on, `owner_id` what the /store routes do.
      const producer = await producerFor(foodDistribution, { owner_id: vendor.actorId, seller_id: vendor.seller.id })
      const order = await homeOrder(foodDistribution, producer.id)
      const made = await safe(
        api.post(
          "/store/food-deliveries",
          { order_id: order.id, pickup_address: "1 Kitchen Way", proof_type: "PIN_CODE", ...HOME },
          store
        )
      )
      expect(made.status).toBe(201)
      const deliveryId = made.data.delivery.id as string
      const stored = async (id: string) => (await foodDistribution.retrieveFoodDelivery(id)).status_history
      // What the service wrote: an object, not a list.
      expect(await stored(deliveryId)).toEqual({ entries: [expect.objectContaining({ status: "PENDING" })] })

      // The panel's status button. 500 "existingHistory is not iterable".
      const waiting = await safe(
        api.post(`/vendor/deliveries/${deliveryId}`, { status: "WAITING_FOR_ORDER", note: "bagged" }, panel)
      )
      expect([waiting.status, waiting.data?.delivery?.id, waiting.data?.delivery?.status]).toEqual([
        200,
        deliveryId,
        "WAITING_FOR_ORDER",
      ])
      // Served as the list the panel renders, the vendor's entry last.
      expect(waiting.data.delivery.status_history).toEqual([
        expect.objectContaining({ status: "PENDING" }),
        expect.objectContaining({ status: "WAITING_FOR_ORDER", note: "bagged", actor: "vendor" }),
      ])
      expect(JSON.stringify(waiting.data)).not.toContain(HOME.proof_pin_code)
      // Stored as the service stores it.
      expect(await stored(deliveryId)).toEqual({
        entries: [
          expect.objectContaining({ status: "PENDING" }),
          expect.objectContaining({ status: "WAITING_FOR_ORDER", note: "bagged", actor: "vendor" }),
        ],
      })
      // With the event every status change has, attributed to the producer.
      const events = await foodDistribution.listDeliveryEvents({ delivery_id: deliveryId, event_type: "status_change" })
      expect(events).toEqual([
        expect.objectContaining({
          previous_status: "PENDING",
          new_status: "WAITING_FOR_ORDER",
          actor_type: "PRODUCER",
          actor_id: vendor.seller.id,
          description: "bagged",
        }),
      ])

      // The service's own next update of the same row still works (the
      // producer's hand-over status through the /store route), and the
      // vendor reads serve all three entries as a list.
      const handedOver = await safe(api.put(`/store/food-deliveries/${deliveryId}`, { status: "ORDER_PICKED_UP" }, store))
      expect([handedOver.status, handedOver.data?.delivery?.status]).toEqual([200, "ORDER_PICKED_UP"])
      const statuses = (history: unknown) =>
        Array.isArray(history) ? (history as Array<{ status: string }>).map((entry) => entry.status) : history
      const detail = await safe(api.get(`/vendor/deliveries/${deliveryId}`, panel))
      expect([detail.status, statuses(detail.data?.delivery?.status_history)]).toEqual([
        200,
        ["PENDING", "WAITING_FOR_ORDER", "ORDER_PICKED_UP"],
      ])
      const list = await safe(api.get("/vendor/deliveries", panel))
      expect([list.status, list.data?.deliveries?.map((row: { id: string }) => row.id)]).toEqual([200, [deliveryId]])
      expect(statuses(list.data.deliveries[0].status_history)).toEqual(["PENDING", "WAITING_FOR_ORDER", "ORDER_PICKED_UP"])
      // A status the vendor sets stamps its time, as on every other path.
      const again = await foodDistribution.createDeliveryForOrder((await homeOrder(foodDistribution, producer.id)).id, {
        pickup_address: "1 Kitchen Way",
        delivery_address: "8 Mill Road",
        recipient_name: "Second",
      })
      expect((await foodDistribution.retrieveFoodDelivery(again.id)).picked_up_at).toBeNull()
      const pickedUp = await safe(api.post(`/vendor/deliveries/${again.id}`, { status: "ORDER_PICKED_UP" }, panel))
      expect(pickedUp.status).toBe(200)
      expect((await foodDistribution.retrieveFoodDelivery(again.id)).picked_up_at).not.toBeNull()

      // Rows that already hold a bare list. The old route wrote one onto any
      // delivery that had no history, and the service's next update of such a
      // row threw. Two of them, as the table would hold them.
      const LIST_SHAPED =
        "SELECT id FROM food_delivery WHERE deleted_at IS NULL AND jsonb_typeof(status_history) = 'array'"
      const listShaped = async () =>
        ((await pg.raw(LIST_SHAPED)).rows as Array<{ id: string }>).map((row) => row.id).sort()
      const LEFT_BY_OLD_ROUTE = [{ status: "ASSIGNED", timestamp: "2026-11-01T10:00:00.000Z", actor: "vendor" }]
      const legacy = async () => {
        const row = await foodDistribution.createFoodDeliveries({
          delivery_number: `DEL-${uid()}`,
          order_id: (await homeOrder(foodDistribution, producer.id)).id,
          producer_id: producer.id,
          pickup_address: "1 Kitchen Way",
          delivery_address: "3 Legacy Lane",
          recipient_name: "Legacy",
        })
        await pg.raw("UPDATE food_delivery SET status_history = ?::jsonb WHERE id = ?", [
          JSON.stringify(LEFT_BY_OLD_ROUTE),
          row.id,
        ])
        return row.id as string
      }
      const viaVendor = await legacy()
      const viaStore = await legacy()
      const viaSql = await legacy()
      expect(Array.isArray(await stored(viaVendor))).toBe(true)
      expect(await listShaped()).toEqual([viaVendor, viaStore, viaSql].sort())

      // The vendor route reads it, appends, and leaves the service's shape.
      const fromList = await safe(api.post(`/vendor/deliveries/${viaVendor}`, { status: "WAITING_FOR_ORDER" }, panel))
      expect([fromList.status, statuses(fromList.data?.delivery?.status_history)]).toEqual([
        200,
        ["ASSIGNED", "WAITING_FOR_ORDER"],
      ])
      expect(await stored(viaVendor)).toEqual({
        entries: [LEFT_BY_OLD_ROUTE[0], expect.objectContaining({ status: "WAITING_FOR_ORDER", actor: "vendor" })],
      })
      // So does the service on any other path: this was a 500.
      const fromListByStore = await safe(api.put(`/store/food-deliveries/${viaStore}`, { status: "WAITING_FOR_ORDER" }, store))
      expect(fromListByStore.status).toBe(200)
      expect(await stored(viaStore)).toEqual({
        entries: [LEFT_BY_OLD_ROUTE[0], expect.objectContaining({ status: "WAITING_FOR_ORDER" })],
      })
      // Each was put right by its next change; the third is still a list.
      expect(await listShaped()).toEqual([viaSql])

      // The operator's rewrite, for rows that are not waiting for a change.
      await pg.raw(
        "UPDATE food_delivery SET status_history = jsonb_build_object('entries', status_history) " +
          "WHERE deleted_at IS NULL AND jsonb_typeof(status_history) = 'array'"
      )
      expect(await listShaped()).toEqual([])
      expect(await stored(viaSql)).toEqual({ entries: LEFT_BY_OLD_ROUTE })
      // And it leaves the rows that were already right as they were.
      expect(await stored(viaVendor)).toEqual({
        entries: [LEFT_BY_OLD_ROUTE[0], expect.objectContaining({ status: "WAITING_FOR_ORDER", actor: "vendor" })],
      })
    })

    it("a signed-in stranger on a courier, a batch and a producer with no owner on record is told nothing their reads keep back", async () => {
      const pak = await createPublishableKeyToken(getContainer)
      const foodDistribution = getContainer().resolve(FOOD_DISTRIBUTION_MODULE)
      // One customer, who owns nothing here.
      const email = `stranger-${uid()}@example.com`
      const password = `${uid()}-pw`
      const registration = await api.post("/auth/customer/emailpass/register", { email, password })
      const customer = await api.post(
        "/store/customers",
        { email },
        { headers: { authorization: `Bearer ${registration.data.token}`, "x-publishable-api-key": pak } }
      )
      const login = await api.post("/auth/customer/emailpass", { email, password })
      const strangerId = customer.data.customer.id as string
      const stranger = { headers: { authorization: `Bearer ${login.data.token}`, "x-publishable-api-key": pak } }

      // Someone else's producer, and its pending deliveries, made by the
      // service as POST /store/food-deliveries makes them.
      const producer = await producerFor(foodDistribution, { owner_id: "cus_someone_else_entirely" })
      const pendingDelivery = async () => {
        const order = await homeOrder(foodDistribution, producer.id)
        const delivery = await foodDistribution.createDeliveryForOrder(order.id, {
          pickup_address: "1 Kitchen Way",
          proof_type: "PIN_CODE",
          ...HOME,
        })
        return { id: delivery.id as string, orderId: order.id as string }
      }

      // (i) The claim through a courier nobody owns. Any signed-in account
      // may still write such a courier (grandfathered); the claim answered
      // 200 with the delivery, which the same account is refused on GET, and
      // left the delivery with a courier no account can carry it as.
      const unowned = await foodDistribution.createCouriers({
        first_name: "No",
        last_name: "Owner-On-Record",
        email: `unowned-${uid()}@example.com`,
        phone: "+15550122",
      })
      const pending = await pendingDelivery()
      expect((await safe(api.put(`/store/couriers/${unowned.id}`, { status: "AVAILABLE" }, stranger))).status).toBe(200)
      for (const [what, id] of [
        ["pending", pending.id],
        ["missing", flipLast(pending.id)],
      ] as const) {
        const claim = await safe(api.post(`/store/couriers/${unowned.id}`, { delivery_id: id }, stranger))
        expect([what, claim.status, claim.data]).toEqual([what, 403, refusal])
        expectNothingOfDelivery(what, claim.data, [pending.id, pending.orderId])
      }
      const unclaimed = await foodDistribution.retrieveFoodDelivery(pending.id)
      expect([unclaimed.courier_id, unclaimed.status, unclaimed.assigned_at]).toEqual([null, "PENDING", null])
      // The courier was not put on a delivery either.
      expect((await foodDistribution.retrieveCourier(unowned.id)).status).toBe("AVAILABLE")
      const direct = await safe(api.get(`/store/food-deliveries/${pending.id}`, stranger))
      expect([direct.status, direct.data]).toEqual([403, refusal])

      // A shift on that courier. The stranger is refused its schedule on
      // GET; a shift inside one it has answered 400 "Shift overlaps with
      // existing shift" and one clear of it 201. One refusal now, and no
      // shift booked.
      await foodDistribution.createCourierShifts({
        courier: unowned.id,
        scheduled_start: new Date(SHIFT.scheduled_start),
        scheduled_end: new Date(SHIFT.scheduled_end),
        notes: "home by 5",
      })
      const schedule = await safe(api.get(`/store/couriers/${unowned.id}/shifts`, stranger))
      expect([schedule.status, schedule.data]).toEqual([403, refusal])
      for (const [what, window] of [
        ["inside a shift", INSIDE_IT],
        ["clear of every shift", CLEAR_OF_IT],
      ] as const) {
        const booked = await safe(api.post(`/store/couriers/${unowned.id}/shifts`, window, stranger))
        expect([what, booked.status, booked.data]).toEqual([what, 403, refusal])
      }
      expect(await foodDistribution.listCourierShifts({ courier_id: unowned.id })).toHaveLength(1)

      // A producer with no owner on record that hides its address (a
      // cottage-food producer working from home). GET keeps the street lines
      // and coordinates back; the stranger's empty PUT answered with them.
      const DOORSTEP = {
        hide_address: true,
        address_line_1: "5 Hidden Home St",
        address_line_2: "Rear flat",
        city: "Springfield",
        latitude: 41.5,
        longitude: -87.25,
      }
      const doorstepOf = (answer: { data?: { producer?: Record<string, unknown> } }) =>
        ["address_line_1", "address_line_2", "latitude", "longitude", "city"].map((field) => answer.data?.producer?.[field])
      const homeKitchen = await producerFor(foodDistribution, DOORSTEP)
      expect(homeKitchen.owner_id).toBeNull()
      const served = await safe(api.get(`/store/food-producers/${homeKitchen.id}`, stranger))
      expect([served.status, doorstepOf(served)]).toEqual([200, [null, null, null, null, "Springfield"]])
      const acknowledged = await safe(api.put(`/store/food-producers/${homeKitchen.id}`, {}, stranger))
      expect([acknowledged.status, doorstepOf(acknowledged)]).toEqual([200, [null, null, null, null, "Springfield"]])
      // The coordinates are covered by the fields above; as text they could
      // match a timestamp.
      for (const value of ["Hidden Home", "Rear flat"]) {
        expect([value, JSON.stringify(acknowledged.data).includes(value)]).toEqual([value, false])
      }
      // What GET serves, field for field (GET adds whether it is open now).
      expect(Object.keys(acknowledged.data.producer).sort()).toEqual(
        Object.keys(served.data.producer)
          .filter((field) => field !== "is_currently_open")
          .sort()
      )
      // The row was not what was kept back: it still holds the address.
      expect((await foodDistribution.retrieveFoodProducer(homeKitchen.id)).address_line_1).toBe(DOORSTEP.address_line_1)
      // The recorded owner of a producer is still echoed theirs whole.
      const ownKitchen = await producerFor(foodDistribution, { ...DOORSTEP, owner_id: strangerId, owner_type: "customer" })
      const ownProducerEcho = await safe(api.put(`/store/food-producers/${ownKitchen.id}`, {}, stranger))
      expect([ownProducerEcho.status, doorstepOf(ownProducerEcho)]).toEqual([
        200,
        [DOORSTEP.address_line_1, DOORSTEP.address_line_2, DOORSTEP.latitude, DOORSTEP.longitude, "Springfield"],
      ])

      // (iii) A batch with no owner on record, behind FF_PICK_PACK_V1. The
      // stranger is refused it on GET and its list is empty; the PUT echoed
      // the whole row, with the id of every delivery in the run.
      const first = await pendingDelivery()
      const second = await pendingDelivery()
      const outside = await pendingDelivery()
      const run = await foodDistribution.createDeliveryBatch([first.id, second.id])
      const ROUTE = [
        { delivery_id: first.id, sequence: 1 },
        { delivery_id: second.id, sequence: 2 },
      ]
      await foodDistribution.updateDeliveryBatches({
        id: run.id,
        // A list, as PUT /store/delivery-batches/:id writes it; the column is
        // json, which the generated type calls a record.
        optimized_route: ROUTE as unknown as Record<string, unknown>,
        notes: "leave at the side gate",
      })
      expect((await foodDistribution.retrieveDeliveryBatch(run.id)).owner_id).toBeNull()

      process.env.FF_PICK_PACK_V1 = "true"
      const refusedRead = await safe(api.get(`/store/delivery-batches/${run.id}`, stranger))
      expect([refusedRead.status, refusedRead.data]).toEqual([403, refusal])
      const emptyList = await safe(api.get("/store/delivery-batches", stranger))
      expect([emptyList.status, emptyList.data?.batches, emptyList.data?.count]).toEqual([200, [], 0])

      const echoed = await safe(api.put(`/store/delivery-batches/${run.id}`, {}, stranger))
      expect([echoed.status, echoed.data]).toEqual([200, { batch: { id: run.id, status: "PLANNING" } }])
      const noted = await safe(api.put(`/store/delivery-batches/${run.id}`, { notes: "x" }, stranger))
      expect([noted.status, noted.data]).toEqual([200, { batch: { id: run.id, status: "PLANNING" } }])
      for (const answer of [echoed, noted]) {
        expectNothingOfDelivery("batch PUT", answer.data, [first.id, second.id, first.orderId, "side gate"])
      }

      // A route entry answered 200 for a delivery in the run and 403 for one
      // outside it, and rewrote the sequence of deliveries the stranger may
      // not read. One refusal now, and nothing written.
      for (const [what, id] of [
        ["in the batch", first.id],
        ["in no batch", outside.id],
        ["missing", flipLast(first.id)],
      ] as const) {
        const entry = await safe(
          api.put(`/store/delivery-batches/${run.id}`, { optimized_route: [{ delivery_id: id, sequence: 9 }] }, stranger)
        )
        expect([what, entry.status, entry.data]).toEqual([what, 403, refusal])
      }
      expect((await foodDistribution.retrieveFoodDelivery(first.id)).batch_sequence).toBe(1)
      expect((await foodDistribution.retrieveFoodDelivery(outside.id)).batch_sequence).toBeNull()
      expect((await foodDistribution.retrieveDeliveryBatch(run.id)).optimized_route).toEqual(ROUTE)

      // Adding a delivery to it. The stranger is the recipient of one, so it
      // may read that one and, by the interim rule, batch it. Added to this
      // run it was answered `total_deliveries: 3` and read `batch_sequence`
      // 3 back off its own delivery: how many deliveries a run it is refused
      // holds. Refused now, and the delivery is left in no batch.
      const theirs = await foodDistribution.createDeliveryForOrder(
        (await homeOrder(foodDistribution, producer.id, { customer_id: strangerId })).id,
        { pickup_address: "1 Kitchen Way", delivery_address: "2 Their Own Road", recipient_name: "Themself" }
      )
      const theirOwn = async () => {
        const read = await safe(api.get(`/store/food-deliveries/${theirs.id}`, stranger))
        return [read.status, read.data?.delivery?.batch_id, read.data?.delivery?.batch_sequence]
      }
      expect(await theirOwn()).toEqual([200, null, null])
      const addedToRun = await safe(api.post(`/store/delivery-batches/${run.id}`, { delivery_ids: [theirs.id] }, stranger))
      expect([addedToRun.status, addedToRun.data]).toEqual([403, refusal])
      expect(await theirOwn()).toEqual([200, null, null])
      expect((await foodDistribution.retrieveDeliveryBatch(run.id)).total_deliveries).toBe(2)
      expect(await foodDistribution.listFoodDeliveries({ batch_id: run.id })).toHaveLength(2)

      // The batch's recorded owner is still echoed the row and still
      // sequences it.
      const mine = await foodDistribution.createDeliveryBatch([outside.id], undefined, undefined, undefined, {
        id: strangerId,
        type: "customer",
      })
      const ownEcho = await safe(
        api.put(
          `/store/delivery-batches/${mine.id}`,
          { notes: "mine", optimized_route: [{ delivery_id: outside.id, sequence: 4 }] },
          stranger
        )
      )
      expect([ownEcho.status, ownEcho.data?.batch?.owner_id, ownEcho.data?.batch?.notes]).toEqual([200, strangerId, "mine"])
      expect(ownEcho.data.batch.optimized_route).toEqual([{ delivery_id: outside.id, sequence: 4 }])
      expect((await foodDistribution.retrieveFoodDelivery(outside.id)).batch_sequence).toBe(4)
      // And still adds to it, and is told its size.
      const addedToOwn = await safe(api.post(`/store/delivery-batches/${mine.id}`, { delivery_ids: [theirs.id] }, stranger))
      expect([addedToOwn.status, addedToOwn.data]).toEqual([200, { success: true, total_deliveries: 2 }])
      expect(await theirOwn()).toEqual([200, mine.id, 2])
    })
  },
})
