import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createPublishableKeyToken } from "./_publishable-key"
import { safe } from "./helpers/seller-auth"
import { FOOD_DISTRIBUTION_MODULE } from "../../src/modules/food-distribution"
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
 * on record, closes the delivery. Each was open to any signed-in account. The unit spec (`src/api/store/__tests__/community-write-authz.unit.spec.ts`)
 * covers the same routes with a fake container; this one proves the guards
 * hold through `authenticate`, `actorOwnsProducer` / `actorOwnsCourier`'s real
 * lookups, and the `food_delivery` / `food_order` tables.
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
    })
  },
})
