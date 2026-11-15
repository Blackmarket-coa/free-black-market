import {
  createDeliveryZoneSchema,
  deliveryZoneCheckRequestSchema,
  updateDeliveryZoneSchema,
} from "../../api/delivery-zones/contracts"
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

  it("leaves fields an update does not send absent, rather than defaulting them", () => {
    // zod 4 keeps `.default()` under `.partial()`; a rename must not zero the
    // fees or re-activate a zone that was switched off.
    expect(updateDeliveryZoneSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" })
  })

  it("still defaults the same fields on create", () => {
    const zone = createDeliveryZoneSchema.parse({
      name: "Zone A",
      code: "ZONE-A",
      center_latitude: 40.7,
      center_longitude: -74,
      boundary: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
    })
    expect(zone).toEqual(
      expect.objectContaining({ base_delivery_fee: 0, per_mile_fee: 0, active: true, priority: 0 })
    )
  })
})
