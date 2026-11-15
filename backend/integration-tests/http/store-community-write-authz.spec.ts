import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createPublishableKeyToken } from "./_publishable-key"
import { createAuthenticatedSeller, safe } from "./helpers/seller-auth"
import { GARDEN_MODULE } from "../../src/modules/garden"
import { FOOD_DISTRIBUTION_MODULE } from "../../src/modules/food-distribution"

jest.setTimeout(180 * 1000)

/**
 * The community `/store` writes, against a migrated database and the real
 * middleware stack: an account that does not own a garden or a delivery zone
 * cannot change it, and the account that does still can.
 *
 * The unit spec (`src/api/store/__tests__/community-write-authz.unit.spec.ts`)
 * covers every route with a fake container. This one proves the parts a fake
 * cannot: that the organizer lookup's `membership_type` / `status` filters
 * bind against the real `garden_membership` table (a self-appointed pending
 * organizer stays out), and that a seller's token on a `/store` route resolves
 * through the member table to the same `sel_` id `/vendor/delivery-zones`
 * stamps.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

    async function signedInCustomer(pak: string) {
      const email = `community-${uid()}@example.com`
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

    const asSeller = (token: string, pak: string) => ({
      headers: { authorization: `Bearer ${token}`, "x-publishable-api-key": pak },
    })

    async function readGarden(id: string) {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "garden",
        fields: ["id", "name", "status", "operating_account_id", "total_plots"],
        filters: { id },
      })
      return data[0] as Record<string, unknown>
    }

    it("a garden is managed by its active organizer and nobody else", async () => {
      const pak = await createPublishableKeyToken(getContainer)
      const creator = await signedInCustomer(pak)
      const stranger = await signedInCustomer(pak)

      const created = await safe(
        api.post(
          "/store/gardens",
          { name: `Garden ${uid()}`, address: "1 Main St", city: "Oakland", state: "CA", zip: "94607" },
          creator.headers
        )
      )
      expect(created.status).toBe(201)
      const gardenId = created.data.garden.id as string

      // The creator's membership is what authorizes later writes.
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: memberships } = await query.graph({
        entity: "garden_membership",
        fields: ["customer_id", "membership_type", "status"],
        filters: { garden_id: gardenId },
      })
      expect(memberships).toEqual([
        expect.objectContaining({ customer_id: creator.id, membership_type: "organizer", status: "active" }),
      ])

      // A stranger cannot edit it, add a plot, or open a season.
      const hijack = await safe(
        api.put(`/store/gardens/${gardenId}`, { name: "Hijacked", operating_account_id: "acct_x" }, stranger.headers)
      )
      expect(hijack.status).toBe(403)
      const plot = await safe(api.post(`/store/gardens/${gardenId}/plots`, { plot_number: "Z9" }, stranger.headers))
      expect(plot.status).toBe(403)
      const season = await safe(
        api.post("/store/seasons", { garden_id: gardenId, name: "Spring", season_type: "spring" }, stranger.headers)
      )
      expect(season.status).toBe(403)

      // Joining as an "organizer" yourself lands as pending, which does not count.
      await getContainer()
        .resolve(GARDEN_MODULE)
        .createGardenMemberships({
          garden_id: gardenId,
          customer_id: stranger.id,
          membership_type: "organizer",
          status: "pending",
          joined_at: new Date(),
        })
      const climb = await safe(api.put(`/store/gardens/${gardenId}`, { name: "Hijacked" }, stranger.headers))
      expect(climb.status).toBe(403)

      // A missing garden is refused exactly like someone else's.
      const missing = await safe(api.put(`/store/gardens/gdn_missing`, { name: "x" }, stranger.headers))
      expect(missing.status).toBe(403)

      expect(await readGarden(gardenId)).toEqual(
        expect.objectContaining({ status: "planning", operating_account_id: null, total_plots: 0 })
      )

      // The organizer can, and the ledger account id in the body is ignored.
      const renamed = await safe(
        api.put(
          `/store/gardens/${gardenId}`,
          { name: "Renamed", status: "active", operating_account_id: "acct_x" },
          creator.headers
        )
      )
      expect(renamed.status).toBe(200)
      const ownPlot = await safe(
        api.post(`/store/gardens/${gardenId}/plots`, { plot_number: "A1", size_sqft: 100 }, creator.headers)
      )
      expect(ownPlot.status).toBe(201)

      expect(await readGarden(gardenId)).toEqual(
        expect.objectContaining({ name: "Renamed", status: "active", operating_account_id: null, total_plots: 1 })
      )
    })

    it("a delivery zone written through /store belongs to the seller who created it", async () => {
      const pak = await createPublishableKeyToken(getContainer)
      const owner = await createAuthenticatedSeller({ api, getContainer })
      const rival = await createAuthenticatedSeller({ api, getContainer })
      const customer = await signedInCustomer(pak)

      const zone = {
        name: "East",
        code: `E-${Math.floor(Math.random() * 1e6)}`,
        boundary: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] },
        center_latitude: 0.5,
        center_longitude: 0.5,
        base_delivery_fee: 500,
      }

      const byCustomer = await safe(api.post("/store/delivery-zones", zone, customer.headers))
      expect(byCustomer.status).toBe(403)

      const created = await safe(api.post("/store/delivery-zones", zone, asSeller(owner.token, pak)))
      expect(created.status).toBe(201)
      const zoneId = created.data.zone.id as string
      expect(created.data.zone.created_by_seller_id).toBe(owner.seller.id)

      const reprice = await safe(
        api.put(`/store/delivery-zones/${zoneId}`, { base_delivery_fee: 0 }, asSeller(rival.token, pak))
      )
      expect(reprice.status).toBe(403)
      const deactivate = await safe(api.delete(`/store/delivery-zones/${zoneId}`, asSeller(rival.token, pak)))
      expect(deactivate.status).toBe(403)
      const byCustomerPut = await safe(
        api.put(`/store/delivery-zones/${zoneId}`, { base_delivery_fee: 0 }, customer.headers)
      )
      expect(byCustomerPut.status).toBe(403)

      const foodDistribution = getContainer().resolve(FOOD_DISTRIBUTION_MODULE)
      const untouched = await foodDistribution.retrieveDeliveryZone(zoneId)
      expect(Number(untouched.base_delivery_fee)).toBe(500)
      expect(untouched.active).toBe(true)

      const ownReprice = await safe(
        api.put(`/store/delivery-zones/${zoneId}`, { base_delivery_fee: 300 }, asSeller(owner.token, pak))
      )
      expect(ownReprice.status).toBe(200)
      const after = await foodDistribution.retrieveDeliveryZone(zoneId)
      expect(Number(after.base_delivery_fee)).toBe(300)
    })
  },
})
