import {
  EARTH_RADIUS_KM,
  EARTH_RADIUS_MILES,
  distanceKm,
  distanceMiles,
} from "../geo-distance"

/**
 * W5 (decision D5): the one great-circle implementation, replacing six
 * copy-pasted haversines. Vectors pin the numeric behavior the call sites
 * shipped with (R=3959 miles / 6371 km, atan2 form) so consolidation is a
 * pure refactor.
 */

const DETROIT = { lat: 42.3314, lng: -83.0458 }
const ANN_ARBOR = { lat: 42.2808, lng: -83.743 }
const NYC = { lat: 40.7128, lng: -74.006 }
const LA = { lat: 34.0522, lng: -118.2437 }

describe("distanceMiles", () => {
  it("zero for identical points", () => {
    expect(distanceMiles(NYC.lat, NYC.lng, NYC.lat, NYC.lng)).toBeCloseTo(0, 6)
  })

  it("NYC → LA lands on the known ~2,445-mile great-circle distance", () => {
    const d = distanceMiles(NYC.lat, NYC.lng, LA.lat, LA.lng)
    expect(d).toBeGreaterThan(2420)
    expect(d).toBeLessThan(2470)
  })

  it("is symmetric", () => {
    const ab = distanceMiles(NYC.lat, NYC.lng, LA.lat, LA.lng)
    const ba = distanceMiles(LA.lat, LA.lng, NYC.lat, NYC.lng)
    expect(ab).toBeCloseTo(ba, 9)
  })
})

describe("distanceKm", () => {
  it("Detroit → Ann Arbor sits in the 50–65 km band the aid spec pins", () => {
    const d = distanceKm(DETROIT.lat, DETROIT.lng, ANN_ARBOR.lat, ANN_ARBOR.lng)
    expect(d).toBeGreaterThan(50)
    expect(d).toBeLessThan(65)
  })

  it("miles and km agree through the radius ratio", () => {
    const miles = distanceMiles(NYC.lat, NYC.lng, LA.lat, LA.lng)
    const km = distanceKm(NYC.lat, NYC.lng, LA.lat, LA.lng)
    expect(km / miles).toBeCloseTo(EARTH_RADIUS_KM / EARTH_RADIUS_MILES, 9)
  })
})
