import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createPublishableKeyToken } from "./_publishable-key"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"
import { FOOD_DISTRIBUTION_MODULE } from "../../src/modules/food-distribution"
import { DeliveryStatus, ProofType } from "../../src/modules/food-distribution/models/delivery"
import {
  FoodOrderStatus,
  TransactionType,
} from "../../src/modules/food-distribution/models/food-order"

jest.setTimeout(180 * 1000)

/**
 * The food-network `/store` writes, against a migrated database and the real
 * middleware stack: a pending trade is settled by its producer, a delivery is
 * attached to an order by that order's producer (once), only the assigned
 * courier writes the courier's position, and only that courier, with the PIN
 * on record, closes the delivery. Each was open to any signed-in account. A
 * delivery's reads refuse a missing id as they refuse someone else's (they
 * answered 404 and 403), and so do the reads of one trade, one of a
 * producer's orders and one delivery batch (`d10-5-read-scoping.unit.spec.ts`
 * has the same cases on a fake container). The unit spec (`src/api/store/__tests__/community-write-authz.unit.spec.ts`)
 * covers the same routes with a fake container; this one proves the guards
 * hold through `authenticate`, `actorOwnsProducer` / `actorOwnsCourier`'s real
 * lookups, and the `food_delivery` / `food_order` tables.
 *
 * The sections after the PIN budget are the routes that still handed a
 * delivery to someone who may not read it, or told callers which ids exist,
 * once those reads were closed (SD-106, SD-107): the courier read and its
 * shifts, the producer-order PUT, the courier claim, batching (behind
 * FF_PICK_PACK_V1) and `/vendor/deliveries/:id`. They are in this one case,
 * with its three customers, because signing a customer in costs three of
 * the 20 requests a minute the auth rate limit allows one address, and the
 * two sellers below take four more.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

    async function signedInCustomer(pak: string) {
      const email = `food-${uid()}@example.com`
      const password = `${uid()}-pw`
      const registered = await api.post("/auth/customer/emailpass/register", { email, password })
      const created = await api.post(
        "/store/customers",
        { email },
        { headers: { authorization: `Bearer ${registered.data.token}`, "x-publishable-api-key": pak } }
      )
      const login = await api.post("/auth/customer/emailpass", { email, password })
      return {
        id: created.data.customer.id as string,
        headers: { headers: { authorization: `Bearer ${login.data.token}`, "x-publishable-api-key": pak } },
      }
    }

    // Evidence URLs (photo_url, signature_url) must name a file under the
    // configured file provider's https base (`platformFileUrlBases`, read per
    // call). The test env configures no storage, which accepts no URL at all,
    // so every evidence URL would be refused by that rule before the proof
    // type was compared, and the "PHOTO instead of PIN" case below would pass
    // on the URL rule rather than on the type check it is there to prove. Set
    // the local provider's base for this case only.
    const PLATFORM_FILES = "https://api.fbm.test/static"
    const savedBackendUrl = process.env.BACKEND_URL
    beforeEach(() => {
      process.env.BACKEND_URL = "https://api.fbm.test"
    })
    afterEach(() => {
      if (savedBackendUrl === undefined) delete process.env.BACKEND_URL
      else process.env.BACKEND_URL = savedBackendUrl
    })

    it("trades, delivery creation, tracking and proof belong to their producer and courier", async () => {
      const pak = await createPublishableKeyToken(getContainer)
      const producerOwner = await signedInCustomer(pak)
      const courierOwner = await signedInCustomer(pak)
      const stranger = await signedInCustomer(pak)
      const foodDistribution = getContainer().resolve(FOOD_DISTRIBUTION_MODULE)

      const producer = await foodDistribution.createFoodProducers({
        name: "Kitchen",
        handle: `kitchen-${uid()}`,
        email: `kitchen-${uid()}@example.com`,
        owner_id: producerOwner.id,
      })
      const courier = await foodDistribution.createCouriers({
        first_name: "C",
        last_name: "R",
        email: `courier-${uid()}@example.com`,
        phone: "5550100",
        owner_id: courierOwner.id,
      })
      const order = (transaction_type: TransactionType) =>
        foodDistribution.createFoodOrders({
          order_number: `FO-${uid()}`,
          transaction_type,
          producer_id: producer.id,
          recipient_name: "Recipient",
          items: {},
          ordered_at: new Date(),
          status: FoodOrderStatus.PENDING,
        })
      // The completion events a delivery's producer reads back from
      // GET /store/food-deliveries/:id (the saved rows, as served).
      const completionEvents = async (deliveryId: string) => {
        const read = await safe(api.get(`/store/food-deliveries/${deliveryId}`, producerOwner.headers))
        expect(read.status).toBe(200)
        return (read.data.delivery.events as Array<{ event_type: string; description: string | null }>)
          .filter((event) => event.event_type === "proof_of_delivery")
          .map((event) => event.description)
      }

      // A pending trade is settled by its producer, not by whoever asks first.
      const trade = await order(TransactionType.TRADE)
      const hijacked = await safe(api.post(`/store/food-trades/${trade.id}`, { accepted: true }, stranger.headers))
      expect(hijacked.status).toBe(403)
      expect((await foodDistribution.retrieveFoodOrder(trade.id)).status).toBe("PENDING")
      const accepted = await safe(
        api.post(`/store/food-trades/${trade.id}`, { accepted: true }, producerOwner.headers)
      )
      expect(accepted.status).toBe(200)
      expect((await foodDistribution.retrieveFoodOrder(trade.id)).status).toBe("CONFIRMED")

      // A delivery is attached to an order by that order's producer, once.
      const sale = await order(TransactionType.SALE)
      const deliveryBody = {
        order_id: sale.id,
        pickup_address: "1 Kitchen Way",
        delivery_address: "2 Home St",
        recipient_name: "Recipient",
        proof_type: "PIN_CODE",
        proof_pin_code: "4821",
      }
      const foreign = await safe(api.post("/store/food-deliveries", deliveryBody, stranger.headers))
      expect(foreign.status).toBe(403)
      const made = await safe(api.post("/store/food-deliveries", deliveryBody, producerOwner.headers))
      expect(made.status).toBe(201)
      expect(made.data.delivery).not.toHaveProperty("proof_pin_code")
      const twice = await safe(api.post("/store/food-deliveries", deliveryBody, producerOwner.headers))
      expect(twice.status).toBe(409)
      const deliveries = await foodDistribution.listFoodDeliveries({ order_id: sale.id })
      expect(deliveries).toHaveLength(1)

      // Only the assigned courier moves the courier on the map.
      const deliveryId = made.data.delivery.id as string
      await foodDistribution.updateFoodDeliveries({ id: deliveryId, courier_id: courier.id })
      const spoofed = await safe(
        api.post(`/store/food-deliveries/${deliveryId}/track`, { latitude: 10, longitude: 10 }, stranger.headers)
      )
      expect(spoofed.status).toBe(403)
      const byProducer = await safe(
        api.post(`/store/food-deliveries/${deliveryId}/track`, { latitude: 10, longitude: 10 }, producerOwner.headers)
      )
      expect(byProducer.status).toBe(403)
      const tracked = await safe(
        api.post(`/store/food-deliveries/${deliveryId}/track`, { latitude: 37.8, longitude: -122.27 }, courierOwner.headers)
      )
      expect(tracked.status).toBe(200)
      const afterTrack = await foodDistribution.retrieveFoodDelivery(deliveryId)
      expect(afterTrack.last_known_latitude).toBeCloseTo(37.8)

      // Reads are for the delivery's producer, courier and recipient, and a
      // delivery that does not exist is refused exactly as someone else's
      // is: same status, same body (`forbidden`). The three GETs read the
      // delivery with a bare `retrieveFoodDelivery`, which throws a
      // not-found instead of returning null, so a missing id answered 404
      // and a real one 403. These reads need no sign-in to be attempted, so
      // the pair of answers told anyone at all which delivery ids exist.
      const missingId = `${deliveryId.slice(0, -1)}${deliveryId.endsWith("0") ? "1" : "0"}`
      expect(await foodDistribution.listFoodDeliveries({ id: missingId })).toHaveLength(0)
      const refusal = { message: "You do not have access to this record.", type: "not_allowed" }
      const anonymous = { headers: { "x-publishable-api-key": pak } }
      for (const read of ["", "/track", "/subscribe"]) {
        for (const [who, caller] of [
          ["stranger", stranger.headers],
          ["anonymous", anonymous],
        ] as const) {
          const someoneElses = await safe(api.get(`/store/food-deliveries/${deliveryId}${read}`, caller))
          const missing = await safe(api.get(`/store/food-deliveries/${missingId}${read}`, caller))
          expect([read, who, someoneElses.status, someoneElses.data]).toEqual([read, who, 403, refusal])
          expect([read, who, missing.status, missing.data]).toEqual([read, who, 403, refusal])
        }
      }
      // Its own principals are still served, through the same lookup.
      const producerTrack = await safe(api.get(`/store/food-deliveries/${deliveryId}/track`, producerOwner.headers))
      expect([producerTrack.status, producerTrack.data?.delivery_id]).toEqual([200, deliveryId])
      const courierDetail = await safe(api.get(`/store/food-deliveries/${deliveryId}`, courierOwner.headers))
      expect([courierDetail.status, courierDetail.data?.delivery?.id]).toEqual([200, deliveryId])

      // The other reads of one record by id refuse the same way. Each read
      // its record with a bare module retrieve, which throws a not-found, so
      // the `!record` refusal written under it was never reached and a
      // missing id answered 404 beside a real one's 403.
      const flipLast = (id: string) => `${id.slice(0, -1)}${id.endsWith("0") ? "1" : "0"}`

      // One trade. No sign-in is needed to try it, and it gave three
      // answers: 403 for a trade, 400 "Order is not a trade" for another
      // kind of order, 404 for an id that does not exist.
      const missingOrderId = flipLast(trade.id)
      expect(await foodDistribution.listFoodOrders({ id: missingOrderId })).toHaveLength(0)
      for (const [who, caller] of [
        ["stranger", stranger.headers],
        ["anonymous", anonymous],
      ] as const) {
        for (const [what, id] of [
          ["a trade", trade.id],
          ["a sale", sale.id],
          ["missing", missingOrderId],
        ] as const) {
          const answer = await safe(api.get(`/store/food-trades/${id}`, caller))
          expect([what, who, answer.status, answer.data]).toEqual([what, who, 403, refusal])
        }
      }
      // Its principals are served: the producer, and the customer on it.
      // Only they are told when an order of theirs is not a trade.
      await foodDistribution.updateFoodOrders({ id: trade.id, customer_id: courierOwner.id })
      for (const [who, caller] of [
        ["producer", producerOwner.headers],
        ["customer", courierOwner.headers],
      ] as const) {
        const own = await safe(api.get(`/store/food-trades/${trade.id}`, caller))
        expect([who, own.status, own.data?.trade?.id]).toEqual([who, 200, trade.id])
      }
      const notATrade = await safe(api.get(`/store/food-trades/${sale.id}`, producerOwner.headers))
      expect([notATrade.status, notATrade.data]).toEqual([400, { message: "Order is not a trade" }])
      const producerMissing = await safe(api.get(`/store/food-trades/${missingOrderId}`, producerOwner.headers))
      expect([producerMissing.status, producerMissing.data]).toEqual([403, refusal])

      // One of a producer's orders. Its owner reads it; to the owner of a
      // different producer it is refused as an order that does not exist is.
      // That pair was 403 "Order does not belong to this producer" and 404,
      // and any account can own a producer.
      const otherProducer = await foodDistribution.createFoodProducers({
        name: "Other kitchen",
        handle: `other-${uid()}`,
        email: `other-${uid()}@example.com`,
        owner_id: stranger.id,
      })
      const ownOrder = await safe(api.get(`/store/food-producers/${producer.id}/orders/${sale.id}`, producerOwner.headers))
      expect([ownOrder.status, ownOrder.data?.order?.id]).toEqual([200, sale.id])
      for (const [what, id] of [
        ["another producer's", sale.id],
        ["missing", missingOrderId],
      ] as const) {
        const answer = await safe(api.get(`/store/food-producers/${otherProducer.id}/orders/${id}`, stranger.headers))
        expect([what, answer.status, answer.data]).toEqual([what, 403, refusal])
      }

      // One delivery batch: the account that planned it and its courier. The
      // prefix is behind FF_PICK_PACK_V1 (off by default, read per request),
      // where a real and a missing batch answer the same 404; with it on
      // they answered 403 and 404.
      const batch = await foodDistribution.createDeliveryBatches({
        batch_number: `B-${uid()}`,
        owner_id: producerOwner.id,
        owner_type: "customer",
        courier_id: courier.id,
      })
      const missingBatchId = flipLast(batch.id)
      expect(await foodDistribution.listDeliveryBatches({ id: missingBatchId })).toHaveLength(0)
      const savedPickPack = process.env.FF_PICK_PACK_V1
      try {
        delete process.env.FF_PICK_PACK_V1
        for (const id of [batch.id, missingBatchId]) {
          const dark = await safe(api.get(`/store/delivery-batches/${id}`, anonymous))
          expect([dark.status, dark.data?.type]).toEqual([404, "feature_disabled"])
        }
        process.env.FF_PICK_PACK_V1 = "true"
        for (const [who, caller] of [
          ["stranger", stranger.headers],
          ["anonymous", anonymous],
        ] as const) {
          for (const [what, id] of [
            ["someone else's", batch.id],
            ["missing", missingBatchId],
          ] as const) {
            const answer = await safe(api.get(`/store/delivery-batches/${id}`, caller))
            expect([what, who, answer.status, answer.data]).toEqual([what, who, 403, refusal])
          }
        }
        for (const [who, caller] of [
          ["planner", producerOwner.headers],
          ["courier", courierOwner.headers],
        ] as const) {
          const own = await safe(api.get(`/store/delivery-batches/${batch.id}`, caller))
          expect([who, own.status, own.data?.batch?.id]).toEqual([who, 200, batch.id])
        }
      } finally {
        if (savedPickPack === undefined) delete process.env.FF_PICK_PACK_V1
        else process.env.FF_PICK_PACK_V1 = savedPickPack
      }

      // Proof of delivery: the courier, with the PIN the delivery was created
      // with. Before the courier lookup read through the module, no courier
      // could pass this check on a real database.
      const courierPut = await safe(
        api.put(`/store/food-deliveries/${deliveryId}`, { status: "ARRIVED_AT_DESTINATION" }, courierOwner.headers)
      )
      expect(courierPut.status).toBe(200)
      const proofUrl = `/store/food-deliveries/${deliveryId}/proof`
      const strangerProof = await safe(
        api.post(proofUrl, { proof_type: "PIN_CODE", pin_code: "4821" }, stranger.headers)
      )
      expect(strangerProof.status).toBe(403)
      // A PHOTO with a URL the evidence rule accepts, so the only thing that
      // can refuse it is the requirement: the PIN is not skipped by naming
      // another type.
      const photoInstead = await safe(
        api.post(proofUrl, { proof_type: "PHOTO", photo_url: `${PLATFORM_FILES}/proof/porch.jpg` }, courierOwner.headers)
      )
      expect([photoInstead.status, photoInstead.data?.message]).toEqual([400, "This delivery requires PIN_CODE proof"])
      // Naming PHOTO is refused even with the right PIN beside it: the
      // delivery is closed as PIN_CODE or not at all.
      const photoWithPin = await safe(
        api.post(
          proofUrl,
          { proof_type: "PHOTO", photo_url: `${PLATFORM_FILES}/proof/porch.jpg`, pin_code: "4821" },
          courierOwner.headers
        )
      )
      expect([photoWithPin.status, photoWithPin.data?.message]).toEqual([400, "This delivery requires PIN_CODE proof"])
      expect((await foodDistribution.retrieveFoodDelivery(deliveryId)).status).toBe("ARRIVED_AT_DESTINATION")
      // A URL off the platform's storage is refused even next to the right
      // PIN, and the delivery stays open.
      const foreignEvidence = await safe(
        api.post(
          proofUrl,
          { proof_type: "PIN_CODE", pin_code: "4821", photo_url: "https://example.com/porch.jpg" },
          courierOwner.headers
        )
      )
      expect([foreignEvidence.status, foreignEvidence.data?.message]).toEqual([
        400,
        "photo_url must be an https URL of a file uploaded to this platform",
      ])
      const wrongPin = await safe(api.post(proofUrl, { proof_type: "PIN_CODE", pin_code: "0000" }, courierOwner.headers))
      expect([wrongPin.status, wrongPin.data?.message]).toEqual([400, "Invalid PIN code"])
      const skipViaPut = await safe(
        api.put(`/store/food-deliveries/${deliveryId}`, { status: "DELIVERED" }, courierOwner.headers)
      )
      expect(skipViaPut.status).toBe(409)
      expect((await foodDistribution.retrieveFoodDelivery(deliveryId)).status).toBe("ARRIVED_AT_DESTINATION")

      const delivered = await safe(api.post(proofUrl, { proof_type: "PIN_CODE", pin_code: "4821" }, courierOwner.headers))
      expect(delivered.status).toBe(200)
      expect(delivered.data.delivery).not.toHaveProperty("proof_pin_code")
      expect((await foodDistribution.retrieveFoodDelivery(deliveryId)).status).toBe("DELIVERED")
      // The PIN is the one thing the courier does not hold, so only it is
      // called proof, in the 200 and in the saved event the delivery's
      // principals read back.
      expect(delivered.data.message).toBe("Delivery completed with PIN_CODE proof")
      expect(await completionEvents(deliveryId)).toEqual(["Delivery completed with PIN_CODE proof"])

      // A PHOTO requirement is met by a file on the platform's storage, and
      // by nothing less. Courier-attested: the URL says where the file is,
      // not what it shows, and the refusals never call it proof.
      const photoSale = await order(TransactionType.SALE)
      const photoMade = await safe(
        api.post(
          "/store/food-deliveries",
          { ...deliveryBody, order_id: photoSale.id, proof_type: "PHOTO", proof_pin_code: undefined },
          producerOwner.headers
        )
      )
      expect(photoMade.status).toBe(201)
      const photoId = photoMade.data.delivery.id as string
      await foodDistribution.updateFoodDeliveries({ id: photoId, courier_id: courier.id })
      expect(
        (await safe(api.put(`/store/food-deliveries/${photoId}`, { status: "ARRIVED_AT_DESTINATION" }, courierOwner.headers)))
          .status
      ).toBe(200)
      const photoSkip = await safe(api.put(`/store/food-deliveries/${photoId}`, { status: "DELIVERED" }, courierOwner.headers))
      expect([photoSkip.status, photoSkip.data?.message]).toEqual([
        409,
        "This delivery requires PHOTO (courier-attested); submit it to /proof",
      ])
      const photoProofUrl = `/store/food-deliveries/${photoId}/proof`
      const photoBare = await safe(api.post(photoProofUrl, { proof_type: "PHOTO" }, courierOwner.headers))
      expect([photoBare.status, photoBare.data?.message]).toEqual([
        400,
        "PHOTO requires photo_url (a file the courier uploaded; not verified)",
      ])
      const photoForeign = await safe(
        api.post(photoProofUrl, { proof_type: "PHOTO", photo_url: "https://example.com/porch.jpg" }, courierOwner.headers)
      )
      expect(photoForeign.status).toBe(400)
      expect((await foodDistribution.retrieveFoodDelivery(photoId)).status).toBe("ARRIVED_AT_DESTINATION")
      const photoUrl = `${PLATFORM_FILES}/proof/${photoId}.jpg`
      const photoDelivered = await safe(
        api.post(photoProofUrl, { proof_type: "PHOTO", photo_url: photoUrl }, courierOwner.headers)
      )
      expect(photoDelivered.status).toBe(200)
      const photoAfter = await foodDistribution.retrieveFoodDelivery(photoId)
      expect([photoAfter.status, photoAfter.proof_type, photoAfter.proof_photo_url]).toEqual([
        "DELIVERED",
        "PHOTO",
        photoUrl,
      ])
      // Accepted as the courier's attestation, and recorded as one: neither
      // the 200 nor the saved delivery event, which GET serves to the
      // producer and the recipient, calls the courier's own file proof. Both
      // used to ("Proof of delivery recorded successfully", "Delivery
      // completed with PHOTO proof").
      expect(photoDelivered.data.message).toBe("Delivery completed with PHOTO (courier-attested)")
      const photoEvents = await completionEvents(photoId)
      expect(photoEvents).toEqual(["Delivery completed with PHOTO (courier-attested)"])
      for (const text of [photoDelivered.data.message, ...photoEvents]) {
        expect(String(text)).not.toMatch(/proof/i)
      }

      // A delivery created with no requirement (NONE, the default) used to
      // take any named type without its evidence: `{ proof_type: "PIN_CODE" }`
      // with no PIN was answered and saved as "Delivery completed with
      // PIN_CODE proof", with proof_type overwritten to PIN_CODE, and PHOTO
      // with no photo as courier-attested. The type is what the 200 and the
      // event say, so it needs its evidence on every delivery.
      const openSale = await order(TransactionType.SALE)
      const openMade = await safe(
        api.post(
          "/store/food-deliveries",
          { ...deliveryBody, order_id: openSale.id, proof_type: undefined, proof_pin_code: undefined },
          producerOwner.headers
        )
      )
      expect([openMade.status, openMade.data.delivery?.proof_type]).toEqual([201, "NONE"])
      const openId = openMade.data.delivery.id as string
      await foodDistribution.updateFoodDeliveries({ id: openId, courier_id: courier.id })
      expect(
        (await safe(api.put(`/store/food-deliveries/${openId}`, { status: "ARRIVED_AT_DESTINATION" }, courierOwner.headers)))
          .status
      ).toBe(200)
      const openProofUrl = `/store/food-deliveries/${openId}/proof`
      const pinUnchecked = await safe(api.post(openProofUrl, { proof_type: "PIN_CODE" }, courierOwner.headers))
      expect([pinUnchecked.status, pinUnchecked.data?.message]).toEqual([400, "Invalid PIN code"])
      const pinNoneOnRecord = await safe(
        api.post(openProofUrl, { proof_type: "PIN_CODE", pin_code: "4821" }, courierOwner.headers)
      )
      expect([pinNoneOnRecord.status, pinNoneOnRecord.data?.message]).toEqual([400, "Invalid PIN code"])
      const photoMissing = await safe(api.post(openProofUrl, { proof_type: "PHOTO" }, courierOwner.headers))
      expect([photoMissing.status, photoMissing.data?.message]).toEqual([
        400,
        "PHOTO requires photo_url (a file the courier uploaded; not verified)",
      ])
      // The service refuses it as well, for a caller that skips the route
      // (the unwired confirmDeliveryStep), reading the delivery's real row.
      await expect(foodDistribution.recordProofOfDelivery(openId, "PIN_CODE", {})).rejects.toThrow("Invalid PIN code")
      const openStill = await foodDistribution.retrieveFoodDelivery(openId)
      expect([openStill.status, openStill.proof_type]).toEqual(["ARRIVED_AT_DESTINATION", "NONE"])
      expect(await completionEvents(openId)).toEqual([])
      // With its evidence it closes, and is named for what it is.
      const signed = await safe(
        api.post(
          openProofUrl,
          { proof_type: "SIGNATURE", signature_url: `${PLATFORM_FILES}/proof/${openId}-sig.png` },
          courierOwner.headers
        )
      )
      expect([signed.status, signed.data?.message]).toEqual([200, "Delivery completed with SIGNATURE (courier-attested)"])
      expect(await completionEvents(openId)).toEqual(["Delivery completed with SIGNATURE (courier-attested)"])

      // The PIN guess budget (5 per 15 minutes per courier per delivery) is
      // keyed on the delivery the handler looks up. It was keyed on the raw
      // path, and Express routes case-insensitively and decodes params, so a
      // percent-encoded id or a re-cased prefix reached the PIN check with a
      // fresh budget: a probe here spent the budget, then closed the delivery
      // with the right PIN through `%xx`-encoded ids.
      const guarded = await safe(
        api.post(
          "/store/food-deliveries",
          { ...deliveryBody, order_id: (await order(TransactionType.SALE)).id, proof_pin_code: "7305" },
          producerOwner.headers
        )
      )
      expect(guarded.status).toBe(201)
      const guardedId = guarded.data.delivery.id as string
      await foodDistribution.updateFoodDeliveries({ id: guardedId, courier_id: courier.id })
      const arrived = await safe(
        api.put(`/store/food-deliveries/${guardedId}`, { status: "ARRIVED_AT_DESTINATION" }, courierOwner.headers)
      )
      expect(arrived.status).toBe(200)

      const guesses: number[] = []
      for (const pin of ["0001", "0002", "0003", "0004", "0005", "0006"]) {
        guesses.push(
          (
            await safe(
              api.post(`/store/food-deliveries/${guardedId}/proof`, { proof_type: "PIN_CODE", pin_code: pin }, courierOwner.headers)
            )
          ).status
        )
      }
      expect(guesses).toEqual([400, 400, 400, 400, 400, 429])

      // Delivery ids are bare ULIDs; any character can be percent-encoded,
      // in either hex case, and each spelling decodes to the same id.
      const pct = (c: string) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`
      const encodedFirst = `${pct(guardedId[0])}${guardedId.slice(1)}`
      const encodedLast = `${guardedId.slice(0, -1)}${pct(guardedId[guardedId.length - 1]).toUpperCase()}`
      const respellings = [
        `/store/food-deliveries/${encodedFirst}/proof`,
        `/store/food-deliveries/${encodedLast}/proof`,
        `/STORE/food-deliveries/${guardedId}/proof`,
        `/store/Food-Deliveries/${encodedLast}/proof`,
        `/store/food-deliveries/${encodedFirst}?x=/proof`,
      ]
      for (const url of respellings) {
        const attempt = await safe(api.post(url, { proof_type: "PIN_CODE", pin_code: "7305" }, courierOwner.headers))
        expect([url, attempt.status]).toEqual([url, 429])
      }
      expect((await foodDistribution.retrieveFoodDelivery(guardedId)).status).toBe("ARRIVED_AT_DESTINATION")

      // ---------------------------------------------------------------
      // SD-106 / SD-107. A delivery to someone's home, made through the real
      // POST by its producer, with values no other row in this case holds.
      // ---------------------------------------------------------------
      const HOME = {
        delivery_address: "14 Orchard Lane",
        delivery_instructions: "gate code 7731",
        recipient_name: "Rita Okafor",
        recipient_phone: "+15550199",
        proof_pin_code: "6042817395",
      }
      const homeOrder = (producerId: string = producer.id) =>
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
        })
      const homeDelivery = async () => {
        const forOrder = await homeOrder()
        const created = await safe(
          api.post(
            "/store/food-deliveries",
            { order_id: forOrder.id, pickup_address: "1 Kitchen Way", proof_type: "PIN_CODE", ...HOME },
            producerOwner.headers
          )
        )
        expect(created.status).toBe(201)
        return { id: created.data.delivery.id as string, orderId: forOrder.id as string }
      }
      // Nothing of a delivery: not where it goes, who it is for, its PIN, or
      // the ids its reads and the claim are keyed on.
      const expectNothingOfDelivery = (who: string, body: unknown, ids: string[]) => {
        const text = JSON.stringify(body)
        for (const value of [...ids, ...Object.values(HOME)]) {
          expect([who, value, text.includes(value)]).toEqual([who, value, false])
        }
      }

      // The courier read. GET /store/couriers/:id returned
      // `active_deliveries`, each the whole food_delivery row (75 keys: the
      // address, the recipient's name and phone, the instructions), to a
      // caller with no account and to a signed-in stranger, both of whom are
      // refused the delivery itself. The courier's id comes from the list.
      const runner = await foodDistribution.createCouriers({
        first_name: "Run",
        last_name: "Ner",
        email: `runner-${uid()}@example.com`,
        phone: "5550144",
        owner_id: courierOwner.id,
      })
      const carried = await homeDelivery()
      await foodDistribution.updateFoodDeliveries({
        id: carried.id,
        courier_id: runner.id,
        status: DeliveryStatus.ASSIGNED,
      })
      const listed = await safe(api.get("/store/couriers?limit=100", anonymous))
      expect(listed.status).toBe(200)
      const listedRunner = (listed.data.couriers as Array<Record<string, unknown>>).find((row) => row.id === runner.id)
      expect(listedRunner).toBeDefined()
      for (const field of ["email", "phone", "last_name", "owner_id", "current_latitude", "total_earnings"]) {
        expect(listedRunner).not.toHaveProperty(field)
      }
      for (const [who, caller] of [
        ["anonymous", anonymous],
        ["stranger", stranger.headers],
      ] as const) {
        const read = await safe(api.get(`/store/couriers/${runner.id}`, caller))
        // Still answers whether the courier is free.
        expect([who, read.status, read.data?.courier?.active_delivery_count]).toEqual([who, 200, 1])
        expect(read.data.courier).not.toHaveProperty("active_deliveries")
        expect(read.data.courier).not.toHaveProperty("email")
        expectNothingOfDelivery(who, read.data, [carried.id, carried.orderId])
        const direct = await safe(api.get(`/store/food-deliveries/${carried.id}`, caller))
        expect([who, direct.status, direct.data]).toEqual([who, 403, refusal])
      }
      // The courier's owner is still served the run, without the PIN.
      const ownRun = await safe(api.get(`/store/couriers/${runner.id}`, courierOwner.headers))
      expect([ownRun.status, ownRun.data?.courier?.active_delivery_count]).toEqual([200, 1])
      const ownRunDeliveries = ownRun.data.courier.active_deliveries as Array<Record<string, unknown>>
      expect(ownRunDeliveries).toHaveLength(1)
      expect(ownRunDeliveries[0]).toMatchObject({
        id: carried.id,
        delivery_address: HOME.delivery_address,
        recipient_phone: HOME.recipient_phone,
      })
      expect(ownRunDeliveries[0]).not.toHaveProperty("proof_pin_code")
      expect(ownRun.data.courier.email).toBe(runner.email)

      // The courier's shifts: when a named person works, in which zone, and
      // what the shift earned. Served to anyone; the owner's now.
      const shift = await safe(
        api.post(
          `/store/couriers/${runner.id}/shifts`,
          { scheduled_start: "2026-12-01T09:00:00.000Z", scheduled_end: "2026-12-01T17:00:00.000Z", notes: "home by 5" },
          courierOwner.headers
        )
      )
      expect(shift.status).toBe(201)
      for (const [who, caller] of [
        ["anonymous", anonymous],
        ["stranger", stranger.headers],
      ] as const) {
        const shifts = await safe(api.get(`/store/couriers/${runner.id}/shifts`, caller))
        expect([who, shifts.status, shifts.data]).toEqual([who, 403, refusal])
      }
      const ownShifts = await safe(api.get(`/store/couriers/${runner.id}/shifts`, courierOwner.headers))
      expect([ownShifts.status, ownShifts.data?.shifts?.map((row: { id: string }) => row.id)]).toEqual([
        200,
        [shift.data.shift.id],
      ])

      // A courier with no owner on record can be written by any signed-in
      // account (grandfathered). The echo of that write was the whole row.
      const unownedCourier = await foodDistribution.createCouriers({
        first_name: "No",
        last_name: "Owner-On-Record",
        email: `unowned-${uid()}@example.com`,
        phone: "+15550122",
        emergency_contact_phone: "+15550133",
      })
      const echoed = await safe(api.put(`/store/couriers/${unownedCourier.id}`, {}, stranger.headers))
      expect([echoed.status, echoed.data?.courier?.id]).toEqual([200, unownedCourier.id])
      for (const value of [unownedCourier.email, "+15550122", "+15550133", "Owner-On-Record"]) {
        expect([value, JSON.stringify(echoed.data).includes(value)]).toEqual([value, false])
      }

      // PUT /store/food-producers/:id/orders/:orderId, as the owner of a
      // different producer: 404 for an order that does not exist beside 403
      // "Order does not belong to this producer", after GET was closed.
      for (const [what, id] of [
        ["another producer's", sale.id],
        ["missing", missingOrderId],
      ] as const) {
        const answer = await safe(
          api.put(`/store/food-producers/${otherProducer.id}/orders/${id}`, { status: "CANCELLED" }, stranger.headers)
        )
        expect([what, answer.status, answer.data]).toEqual([what, 403, refusal])
      }
      expect((await foodDistribution.retrieveFoodOrder(sale.id)).status).toBe("PENDING")
      const confirmed = await safe(
        api.put(`/store/food-producers/${producer.id}/orders/${sale.id}`, { status: "CONFIRMED" }, producerOwner.headers)
      )
      expect([confirmed.status, confirmed.data?.order?.id, confirmed.data?.order?.recipient_name]).toEqual([
        200,
        sale.id,
        "Recipient",
      ])
      // On a producer with no owner on record any signed-in account may act
      // (grandfathered); the echo of the order was its read of the recipient.
      const unownedProducer = await foodDistribution.createFoodProducers({
        name: "Unowned kitchen",
        handle: `unowned-${uid()}`,
        email: `unowned-kitchen-${uid()}@example.com`,
      })
      const unownedOrder = await homeOrder(unownedProducer.id)
      const acknowledged = await safe(
        api.put(
          `/store/food-producers/${unownedProducer.id}/orders/${unownedOrder.id}`,
          { producer_notes: "noted" },
          stranger.headers
        )
      )
      expect([acknowledged.status, acknowledged.data]).toEqual([
        200,
        { order: { id: unownedOrder.id, status: "PENDING" } },
      ])
      // The owner's read of an order serves its delivery without the PIN.
      const ownOrderRead = await safe(
        api.get(`/store/food-producers/${producer.id}/orders/${carried.orderId}`, producerOwner.headers)
      )
      expect([ownOrderRead.status, ownOrderRead.data?.order?.delivery?.id]).toEqual([200, carried.id])
      expect(ownOrderRead.data.order.delivery).not.toHaveProperty("proof_pin_code")

      // POST /store/couriers/:id (claim). Any account can register a courier
      // and mark it available. A delivery that does not exist answered 404,
      // one already assigned 400, and a pending one 200 with the row and the
      // PIN its recipient is meant to read out to the courier.
      const registered = await safe(
        api.post(
          "/store/couriers",
          {
            email: `own-courier-${uid()}@example.com`,
            first_name: "S",
            last_name: "T",
            phone: "5550111",
            courier_type: "INDEPENDENT",
            vehicle_type: "BIKE",
          },
          stranger.headers
        )
      )
      expect(registered.status).toBe(201)
      const strangersCourier = registered.data.courier.id as string
      const markAvailable = () =>
        safe(api.put(`/store/couriers/${strangersCourier}`, { status: "AVAILABLE" }, stranger.headers))
      expect((await markAvailable()).status).toBe(200)
      const pending = await homeDelivery()
      const missingHomeDeliveryId = flipLast(pending.id)
      expect(await foodDistribution.listFoodDeliveries({ id: missingHomeDeliveryId })).toHaveLength(0)
      for (const [what, id] of [
        ["someone else's, assigned", carried.id],
        ["missing", missingHomeDeliveryId],
      ] as const) {
        const answer = await safe(api.post(`/store/couriers/${strangersCourier}`, { delivery_id: id }, stranger.headers))
        expect([what, answer.status, answer.data]).toEqual([what, 403, refusal])
      }
      expect((await foodDistribution.retrieveFoodDelivery(carried.id)).courier_id).toBe(runner.id)
      const claimed = await safe(
        api.post(`/store/couriers/${strangersCourier}`, { delivery_id: pending.id }, stranger.headers)
      )
      expect([claimed.status, claimed.data?.delivery?.id, claimed.data?.delivery?.delivery_address]).toEqual([
        200,
        pending.id,
        HOME.delivery_address,
      ])
      expect(claimed.data.delivery).not.toHaveProperty("proof_pin_code")
      expect(JSON.stringify(claimed.data)).not.toContain(HOME.proof_pin_code)
      // Its courier now, so it is told the delivery is no longer claimable.
      expect((await markAvailable()).status).toBe(200)
      const claimedAgain = await safe(
        api.post(`/store/couriers/${strangersCourier}`, { delivery_id: pending.id }, stranger.headers)
      )
      expect([claimedAgain.status, claimedAgain.data]).toEqual([400, { message: "Delivery is not available for claiming" }])

      // Batching, behind FF_PICK_PACK_V1. With it on, a signed-in stranger
      // batched anyone's delivery and got the row back with its address and
      // PIN (201), added another (200), wrote a sequence onto a third
      // through `optimized_route` (200), and every batch was listed to a
      // caller with no account. The interim rule: a caller batches only a
      // delivery they may already read.
      const theirs = await homeDelivery()
      const alsoTheirs = await homeDelivery()
      const untouched = await homeDelivery()
      const unownedBatch = await foodDistribution.createDeliveryBatches({ batch_number: `B-${uid()}` })
      const batchIds = (answer: { data?: { batches?: Array<{ id: string }> } }) =>
        (answer.data?.batches ?? []).map((row) => row.id).sort()
      try {
        process.env.FF_PICK_PACK_V1 = "true"

        for (const [what, id] of [
          ["someone else's", theirs.id],
          ["missing", flipLast(theirs.id)],
        ] as const) {
          const answer = await safe(api.post("/store/delivery-batches", { delivery_ids: [id] }, stranger.headers))
          expect([what, answer.status, answer.data]).toEqual([what, 403, refusal])
        }
        expect((await foodDistribution.retrieveFoodDelivery(theirs.id)).batch_id).toBeNull()
        expect(await foodDistribution.listDeliveryBatches({ owner_id: stranger.id })).toHaveLength(0)
        // The delivery's producer batches it, and the 201 carries no PIN.
        const producersBatch = await safe(
          api.post("/store/delivery-batches", { delivery_ids: [theirs.id] }, producerOwner.headers)
        )
        expect(producersBatch.status).toBe(201)
        const producersBatchId = producersBatch.data.batch.id as string
        expect(producersBatch.data.batch.deliveries).toHaveLength(1)
        expect(producersBatch.data.batch.deliveries[0]).toMatchObject({
          id: theirs.id,
          delivery_address: HOME.delivery_address,
        })
        expect(producersBatch.data.batch.deliveries[0]).not.toHaveProperty("proof_pin_code")
        // The stranger is the courier of the delivery claimed above, so may
        // read it, so may batch it.
        const strangersBatch = await safe(
          api.post("/store/delivery-batches", { delivery_ids: [pending.id] }, stranger.headers)
        )
        expect(strangersBatch.status).toBe(201)
        const strangersBatchId = strangersBatch.data.batch.id as string

        // Adding to a batch: the same rule, and nothing written on a refusal.
        for (const [what, id] of [
          ["someone else's", alsoTheirs.id],
          ["missing", flipLast(alsoTheirs.id)],
        ] as const) {
          const answer = await safe(
            api.post(`/store/delivery-batches/${strangersBatchId}`, { delivery_ids: [id] }, stranger.headers)
          )
          expect([what, answer.status, answer.data]).toEqual([what, 403, refusal])
        }
        expect((await foodDistribution.retrieveFoodDelivery(alsoTheirs.id)).batch_id).toBeNull()
        const added = await safe(
          api.post(`/store/delivery-batches/${producersBatchId}`, { delivery_ids: [alsoTheirs.id] }, producerOwner.headers)
        )
        expect([added.status, added.data]).toEqual([200, { success: true, total_deliveries: 2 }])

        // A route entry writes only onto a delivery in the batch.
        for (const [what, id] of [
          ["in no batch of theirs", untouched.id],
          ["missing", flipLast(untouched.id)],
        ] as const) {
          const answer = await safe(
            api.put(
              `/store/delivery-batches/${strangersBatchId}`,
              { optimized_route: [{ delivery_id: id, sequence: 7 }] },
              stranger.headers
            )
          )
          expect([what, answer.status, answer.data]).toEqual([what, 403, refusal])
        }
        expect((await foodDistribution.retrieveFoodDelivery(untouched.id)).batch_sequence).toBeNull()
        const sequenced = await safe(
          api.put(
            `/store/delivery-batches/${strangersBatchId}`,
            { optimized_route: [{ delivery_id: pending.id, sequence: 3 }] },
            stranger.headers
          )
        )
        expect(sequenced.status).toBe(200)
        expect((await foodDistribution.retrieveFoodDelivery(pending.id)).batch_sequence).toBe(3)

        // The write verbs on one batch: someone else's as a missing one.
        // They answered 403 "This batch is not yours to manage" and 404.
        for (const [verb, call] of [
          ["PUT", (id: string) => api.put(`/store/delivery-batches/${id}`, { notes: "x" }, stranger.headers)],
          ["POST", (id: string) => api.post(`/store/delivery-batches/${id}`, { delivery_ids: [pending.id] }, stranger.headers)],
          ["DELETE", (id: string) => api.delete(`/store/delivery-batches/${id}`, stranger.headers)],
        ] as const) {
          for (const [what, id] of [
            ["someone else's", batch.id],
            ["missing", missingBatchId],
          ] as const) {
            const answer = await safe(call(id))
            expect([verb, what, answer.status, answer.data]).toEqual([verb, what, 403, refusal])
          }
        }
        const afterWrites = await foodDistribution.retrieveDeliveryBatch(batch.id)
        expect([afterWrites.status, afterWrites.notes]).toEqual(["PLANNING", null])
        // Naming a courier decides who reads the run, so only the batch's
        // recorded owner does it: not whoever writes a batch with no owner.
        const takeover = await safe(
          api.put(`/store/delivery-batches/${unownedBatch.id}`, { courier_id: strangersCourier }, stranger.headers)
        )
        expect([takeover.status, takeover.data]).toEqual([403, refusal])
        expect((await foodDistribution.retrieveDeliveryBatch(unownedBatch.id)).courier_id).toBeNull()

        // The list: nobody without an account, and each caller their own.
        const listedAnonymous = await safe(api.get("/store/delivery-batches", anonymous))
        expect([listedAnonymous.status, listedAnonymous.data]).toEqual([403, refusal])
        const listedStranger = await safe(api.get("/store/delivery-batches", stranger.headers))
        expect([listedStranger.status, batchIds(listedStranger), listedStranger.data?.count]).toEqual([
          200,
          [strangersBatchId],
          1,
        ])
        const listedPlanner = await safe(api.get("/store/delivery-batches", producerOwner.headers))
        expect([listedPlanner.status, batchIds(listedPlanner)]).toEqual([200, [batch.id, producersBatchId].sort()])
        // A courier's runs are listed to the courier's owner, and naming a
        // courier that is not the caller's widens nothing.
        const courierRuns = await safe(api.get(`/store/delivery-batches?courier_id=${courier.id}`, courierOwner.headers))
        expect([courierRuns.status, batchIds(courierRuns)]).toEqual([200, [batch.id]])
        const notTheirCourier = await safe(api.get(`/store/delivery-batches?courier_id=${courier.id}`, stranger.headers))
        expect([notTheirCourier.status, batchIds(notTheirCourier)]).toEqual([200, []])

        // Operator check, for an environment where the flag was ever on: the
        // rule above stops new batches, it does not undo old ones. This lists
        // each delivery sitting in a batch whose planner is not the delivery's
        // producer, courier or recipient, and so reads its address through
        // GET /store/delivery-batches/:id. None of the batches made through
        // the routes above is listed; a delivery put into the stranger's batch
        // the way the old route allowed is, until the stranger is made its
        // recipient.
        const FOREIGN_DELIVERIES_IN_BATCHES =
          "SELECT b.id AS batch_id, b.owner_id AS planner, d.id AS delivery_id " +
          "FROM food_delivery_batch b " +
          "JOIN food_delivery d ON d.batch_id = b.id AND d.deleted_at IS NULL " +
          "LEFT JOIN food_producer p ON p.id = d.producer_id " +
          "LEFT JOIN food_courier c ON c.id = d.courier_id " +
          "LEFT JOIN food_order o ON o.id = d.order_id " +
          "WHERE b.deleted_at IS NULL " +
          "AND b.owner_id IS DISTINCT FROM p.owner_id " +
          "AND b.owner_id IS DISTINCT FROM c.owner_id " +
          "AND b.owner_id IS DISTINCT FROM o.customer_id " +
          "ORDER BY b.id, d.id;"
        const pg = getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        expect((await pg.raw(FOREIGN_DELIVERIES_IN_BATCHES)).rows).toEqual([])
        await foodDistribution.updateFoodDeliveries({ id: untouched.id, batch_id: strangersBatchId })
        expect((await pg.raw(FOREIGN_DELIVERIES_IN_BATCHES)).rows).toEqual([
          { batch_id: strangersBatchId, planner: stranger.id, delivery_id: untouched.id },
        ])
        await foodDistribution.updateFoodOrders({ id: untouched.orderId, customer_id: stranger.id })
        expect((await pg.raw(FOREIGN_DELIVERIES_IN_BATCHES)).rows).toEqual([])
      } finally {
        if (savedPickPack === undefined) delete process.env.FF_PICK_PACK_V1
        else process.env.FF_PICK_PACK_V1 = savedPickPack
      }

      // /vendor/deliveries/:id, as a seller with a producer profile: 404 for
      // a delivery that does not exist beside 403 "This delivery does not
      // belong to your store", on GET and on POST.
      const sellerA = await createAuthenticatedSeller({ api, getContainer })
      const sellerB = await createAuthenticatedSeller({ api, getContainer })
      const storeA = await foodDistribution.createFoodProducers({
        name: "Store A",
        handle: `store-a-${uid()}`,
        email: `store-a-${uid()}@example.com`,
        seller_id: sellerA.seller.id,
      })
      await foodDistribution.createFoodProducers({
        name: "Store B",
        handle: `store-b-${uid()}`,
        email: `store-b-${uid()}@example.com`,
        seller_id: sellerB.seller.id,
      })
      // Created through the module with no status history. The vendor POST
      // reads the history as a list and answers 500 for one written by
      // `createDeliveryForOrder` (an `{ entries }` object): seen here, a
      // separate defect, left as it is.
      const storeDelivery = await foodDistribution.createFoodDeliveries({
        delivery_number: `DEL-${uid()}`,
        order_id: (await homeOrder(storeA.id)).id,
        producer_id: storeA.id,
        pickup_address: "1 Store Way",
        delivery_address: "9 Vendor Home St",
        recipient_name: "Vera",
        proof_type: ProofType.PIN_CODE,
        proof_pin_code: "9911273650",
      })
      const missingStoreDeliveryId = flipLast(storeDelivery.id)
      expect(await foodDistribution.listFoodDeliveries({ id: missingStoreDeliveryId })).toHaveLength(0)
      for (const [verb, call] of [
        ["GET", (id: string) => api.get(`/vendor/deliveries/${id}`, authHeader(sellerB.token))],
        ["POST", (id: string) => api.post(`/vendor/deliveries/${id}`, { status: "CANCELLED" }, authHeader(sellerB.token))],
      ] as const) {
        for (const [what, id] of [
          ["another store's", storeDelivery.id],
          ["missing", missingStoreDeliveryId],
        ] as const) {
          const answer = await safe(call(id))
          expect([verb, what, answer.status, answer.data]).toEqual([verb, what, 403, refusal])
        }
      }
      expect((await foodDistribution.retrieveFoodDelivery(storeDelivery.id)).status).toBe("PENDING")
      // The store's own seller is served, without the PIN, on all three.
      const vendorRead = await safe(api.get(`/vendor/deliveries/${storeDelivery.id}`, authHeader(sellerA.token)))
      expect([vendorRead.status, vendorRead.data?.delivery?.id, vendorRead.data?.delivery?.delivery_address]).toEqual([
        200,
        storeDelivery.id,
        "9 Vendor Home St",
      ])
      const vendorList = await safe(api.get("/vendor/deliveries", authHeader(sellerA.token)))
      expect([vendorList.status, vendorList.data?.deliveries?.map((row: { id: string }) => row.id)]).toEqual([
        200,
        [storeDelivery.id],
      ])
      const vendorWrite = await safe(
        api.post(`/vendor/deliveries/${storeDelivery.id}`, { status: "WAITING_FOR_ORDER" }, authHeader(sellerA.token))
      )
      expect(vendorWrite.status).toBe(200)
      expect((await foodDistribution.retrieveFoodDelivery(storeDelivery.id)).status).toBe("WAITING_FOR_ORDER")
      for (const answer of [vendorRead, vendorList, vendorWrite]) {
        expect(JSON.stringify(answer.data)).not.toContain("proof_pin_code")
        expect(JSON.stringify(answer.data)).not.toContain("9911273650")
      }
    })
  },
})
