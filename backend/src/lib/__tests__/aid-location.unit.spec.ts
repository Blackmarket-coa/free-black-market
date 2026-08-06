import {
  distanceBand,
  distanceKm,
  isWithinReach,
  toPublicAid,
} from "../aid-location"

// Roughly Detroit and Ann Arbor — ~55km apart.
const DETROIT = { latitude: 42.3314, longitude: -83.0458 }
const ANN_ARBOR = { latitude: 42.2808, longitude: -83.743 }
const NEARBY = { latitude: 42.3364, longitude: -83.0458 } // ~0.5km north

describe("distanceKm", () => {
  it("measures a known separation", () => {
    const d = distanceKm(DETROIT, ANN_ARBOR)
    expect(d).not.toBeNull()
    expect(d as number).toBeGreaterThan(50)
    expect(d as number).toBeLessThan(65)
  })

  it("is zero for the same point", () => {
    expect(distanceKm(DETROIT, DETROIT)).toBeCloseTo(0, 5)
  })

  it("returns null when either side has no coordinates", () => {
    expect(distanceKm(DETROIT, {})).toBeNull()
    expect(distanceKm({}, DETROIT)).toBeNull()
    expect(distanceKm({ latitude: 1, longitude: null }, DETROIT)).toBeNull()
  })
})

describe("isWithinReach", () => {
  it("includes an offer whose radius covers the request", () => {
    expect(isWithinReach(DETROIT, { ...ANN_ARBOR, service_radius_km: 100 })).toBe(true)
  })

  it("excludes an offer whose radius falls short", () => {
    expect(isWithinReach(DETROIT, { ...ANN_ARBOR, service_radius_km: 10 })).toBe(false)
  })

  it("treats an unstated radius as unbounded", () => {
    expect(isWithinReach(DETROIT, { ...ANN_ARBOR, service_radius_km: null })).toBe(true)
  })

  it("includes rather than excludes when a location is missing", () => {
    // Dropping a willing helper because someone declined to share a location
    // is a worse failure than surfacing a match they turn out not to want.
    expect(isWithinReach({}, { ...ANN_ARBOR, service_radius_km: 1 })).toBe(true)
    expect(isWithinReach(DETROIT, { service_radius_km: 1 })).toBe(true)
  })
})

describe("distanceBand", () => {
  it("buckets rather than reporting exact distance", () => {
    expect(distanceBand(0.5)).toBe("under 2km")
    expect(distanceBand(3)).toBe("2-5km")
    expect(distanceBand(9)).toBe("5-15km")
    expect(distanceBand(30)).toBe("15-50km")
    expect(distanceBand(200)).toBe("over 50km")
  })

  it("returns null for an unknown distance", () => {
    expect(distanceBand(null)).toBeNull()
  })
})

describe("toPublicAid", () => {
  const row = {
    id: "mar_1",
    requester_id: "cus_secret",
    title: "Nappies, size 3",
    description: "Two packs would cover the week",
    category: "baby-supplies",
    status: "OPEN",
    quantity: 2,
    unit_of_measure: "packs",
    latitude: DETROIT.latitude,
    longitude: DETROIT.longitude,
    locality: "Southwest Detroit",
    created_at: new Date("2026-08-05T00:00:00.000Z"),
    metadata: { internal_note: "referred by clinic" },
  }

  it("never emits coordinates", () => {
    const serialised = JSON.stringify(toPublicAid(row))

    // The whole point: a public board must not let a stranger map where
    // vulnerable people are.
    expect(serialised).not.toContain("42.33")
    expect(serialised).not.toContain("-83.04")
    expect(serialised).not.toContain("latitude")
    expect(serialised).not.toContain("longitude")
  })

  it("never emits the requester id or metadata", () => {
    const serialised = JSON.stringify(toPublicAid(row))

    expect(serialised).not.toContain("cus_secret")
    expect(serialised).not.toContain("referred by clinic")
  })

  it("is whitelist-only, so a new column cannot leak by default", () => {
    const withNewColumn = { ...row, home_address: "12 Elm St", phone: "555-0100" }
    const serialised = JSON.stringify(toPublicAid(withNewColumn))

    // A projection that deleted known-bad fields would start leaking the day
    // someone added a column. This one only emits what it lists.
    expect(serialised).not.toContain("Elm St")
    expect(serialised).not.toContain("555-0100")
  })

  it("keeps the coarse locality the person chose", () => {
    expect(toPublicAid(row).locality).toBe("Southwest Detroit")
  })

  it("emits a distance band, not a distance, when given a vantage point", () => {
    const out = toPublicAid(row, NEARBY)

    expect(out.distance_band).toBe("under 2km")
    // Exact kilometres are themselves a locator: enough of them from known
    // points and you can trilaterate a household.
    expect(JSON.stringify(out)).not.toMatch(/0\.5\d/)
  })

  it("omits the band entirely when no vantage point is given", () => {
    expect(toPublicAid(row)).not.toHaveProperty("distance_band")
  })

  it("survives a row with nothing populated", () => {
    const out = toPublicAid({ id: "mar_2" })

    expect(out.id).toBe("mar_2")
    expect(out.title).toBe("")
    expect(out.locality).toBeNull()
    expect(out.quantity).toBeNull()
  })
})
