import { ZIP_PREFIX_COORDS, zipToCoords } from "../zip3"
import { distanceMiles } from "../geo-distance"

/**
 * The ZIP3 table is the local fallback for every geocode and the reference
 * `geocodePostalCode` checks Blackout's answer against (150 mi), so an entry
 * must sit in its prefix's real area. Each case is a ZIP from the prefix and
 * the city it belongs to.
 */

const within = (zip: string, lat: number, lng: number, miles = 60) => {
  const coords = zipToCoords(zip)
  expect(coords).not.toBeNull()
  const d = distanceMiles(coords!.lat, coords!.lng, lat, lng)
  if (d > miles) {
    throw new Error(`${zip} resolves ${Math.round(d)} mi from its city (limit ${miles})`)
  }
}

describe("ZIP3 table: prefixes that were missing", () => {
  it.each([
    ["88510", 31.76, -106.49], // El Paso TX
    ["40741", 37.13, -84.08], // London KY
    ["40831", 36.86, -83.32], // Harlan KY
    ["40965", 36.61, -83.72], // Middlesboro KY
    ["41240", 37.81, -82.81], // Paintsville KY
    ["41301", 37.73, -83.55], // Campton KY
    ["41501", 37.48, -82.52], // Pikeville KY
    ["41701", 37.25, -83.19], // Hazard KY
    ["41858", 37.12, -82.83], // Whitesburg KY
    ["00603", 18.43, -67.15], // Aguadilla PR
    ["00731", 18.01, -66.61], // Ponce PR
    ["00802", 18.34, -64.93], // St. Thomas VI
    ["00901", 18.47, -66.11], // San Juan PR
    ["52401", 41.98, -91.67], // Cedar Rapids IA
    ["52801", 41.52, -90.58], // Davenport IA
    ["34950", 27.45, -80.33], // Fort Pierce FL
    ["96910", 13.48, 144.75], // Hagatna GU
  ])("%s", (zip, lat, lng) => within(zip, lat, lng))
})

describe("ZIP3 table: entries that pointed at the wrong city", () => {
  it.each([
    ["79701", 31.99, -102.08], // Midland TX (was El Paso, ~250 mi off)
    ["79401", 33.58, -101.85], // Lubbock TX (was El Paso)
    ["79601", 32.45, -99.73], // Abilene TX (was El Paso)
    ["79101", 35.22, -101.83], // Amarillo TX
    ["89301", 39.25, -114.89], // Ely NV (was Reno, ~260 mi off)
    ["99901", 55.34, -131.64], // Ketchikan AK (was interior Alaska)
    ["41011", 39.08, -84.51], // Covington KY (was Akron OH)
    ["41101", 38.48, -82.64], // Ashland KY (was Akron OH)
    ["42301", 37.77, -87.11], // Owensboro KY (was eastern KY)
    ["52001", 42.5, -90.66], // Dubuque IA (was Milwaukee WI)
    ["95110", 37.34, -121.89], // San Jose CA (951 was Riverside)
    ["12901", 44.7, -73.45], // Plattsburgh NY (was Binghamton)
    ["14901", 42.09, -76.81], // Elmira NY (was Plattsburgh)
    ["28401", 34.23, -77.94], // Wilmington NC (was Asheville)
    ["32301", 30.44, -84.28], // Tallahassee FL (was Orlando)
  ])("%s", (zip, lat, lng) => within(zip, lat, lng))
})

describe("ZIP3 table: prefixes that are not places", () => {
  it.each([
    "000", "001", "419", "428", "429", "886", "987",
  ])("unassigned prefix %s is absent", (prefix) => {
    expect(ZIP_PREFIX_COORDS[prefix]).toBeUndefined()
  })

  it.each(["090", "098", "340", "962", "966"])(
    "military APO/FPO prefix %s is absent",
    (prefix) => {
      expect(ZIP_PREFIX_COORDS[prefix]).toBeUndefined()
    }
  )
})
