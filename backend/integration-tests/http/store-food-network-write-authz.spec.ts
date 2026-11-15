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
      const photoInstead = await safe(
        api.post(proofUrl, { proof_type: "PHOTO", photo_url: "https://example.com/porch.jpg" }, courierOwner.headers)
      )
      expect(photoInstead.status).toBe(400)
      const wrongPin = await safe(api.post(proofUrl, { proof_type: "PIN_CODE", pin_code: "0000" }, courierOwner.headers))
      expect(wrongPin.status).toBe(400)
      const skipViaPut = await safe(
        api.put(`/store/food-deliveries/${deliveryId}`, { status: "DELIVERED" }, courierOwner.headers)
      )
      expect(skipViaPut.status).toBe(409)
      expect((await foodDistribution.retrieveFoodDelivery(deliveryId)).status).toBe("ARRIVED_AT_DESTINATION")

      const delivered = await safe(api.post(proofUrl, { proof_type: "PIN_CODE", pin_code: "4821" }, courierOwner.headers))
      expect(delivered.status).toBe(200)
      expect(delivered.data.delivery).not.toHaveProperty("proof_pin_code")
      expect((await foodDistribution.retrieveFoodDelivery(deliveryId)).status).toBe("DELIVERED")
    })
  },
})
