import { createDeliveryZoneSchema, deliveryZoneCheckRequestSchema } from "../../api/delivery-zones/contracts"
import { detectDeliveryZoneConflicts } from "../../api/vendor/delivery-zones/conflict-utils"

describe("delivery zone contracts", () => {
  it("validates check payload contract", () => {
    expect(
      deliveryZoneCheckRequestSchema.parse({
        latitude: 40.7,
        longitude: -74,
      })
    ).toEqual({ latitude: 40.7, longitude: -74 })
  })

  it("detects overlap conflicts with active zones", () => {
    const candidate = createDeliveryZoneSchema.parse({
      name: "Zone A",
      code: "ZONE-A",
      center_latitude: 40.7,
      center_longitude: -74,
      boundary: {
        type: "Polygon",
        coordinates: [[[-74.01, 40.7], [-73.99, 40.7], [-73.99, 40.72], [-74.01, 40.72], [-74.01, 40.7]]],
      },
      base_delivery_fee: 5,
      per_mile_fee: 1,
      active: true,
      priority: 1,
    })

    const conflicts = detectDeliveryZoneConflicts(candidate, [
      {
        id: "zone_1",
        name: "Existing",
        code: "EXISTING",
        active: true,
        center_latitude: 40.705,
        center_longitude: -74,
        boundary: {
          type: "Polygon",
          coordinates: [[[-74.01, 40.705], [-73.98, 40.705], [-73.98, 40.725], [-74.01, 40.725], [-74.01, 40.705]]],
        },
      },
    ])

    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts[0]).toMatchObject({ zone_id: "zone_1" })
  })
})
