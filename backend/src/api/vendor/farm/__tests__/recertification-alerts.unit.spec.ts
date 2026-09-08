import { buildRecertificationAlerts } from "../profile/route"

const cert = (validUntil: string, name = "USDA Organic") => ({
  name,
  valid_until: validUntil,
})

const hoursFromNow = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString()

describe("farm profile recertification alerts", () => {
  it("reports a certification that lapsed within the last day as expired", () => {
    // The regression this pins. With `Math.ceil` the difference for anything
    // inside the 24 hours after expiry is `-0`, `-0 < 0` is false, and the
    // alert read `status: "expiring_soon", days_remaining: 0` — telling a
    // vendor a lapsed certificate was still in date for a further day.
    for (const h of [-1, -6, -12, -23]) {
      const [alert] = buildRecertificationAlerts([cert(hoursFromNow(h))])
      expect(alert).toBeDefined()
      expect(alert.status).toBe("expired")
      expect(alert.days_remaining).toBe(-1)
    }
  })

  it("still reports one lapsed more than a day ago as expired", () => {
    const [alert] = buildRecertificationAlerts([cert(hoursFromNow(-48))])
    expect(alert.status).toBe("expired")
    expect(alert.days_remaining).toBeLessThan(0)
  })

  it("reports one expiring later today as expiring_soon, not expired", () => {
    const [alert] = buildRecertificationAlerts([cert(hoursFromNow(6))])
    expect(alert.status).toBe("expiring_soon")
    expect(alert.days_remaining).toBe(0)
  })

  it("keeps the 30-day notice window", () => {
    expect(buildRecertificationAlerts([cert(hoursFromNow(24 * 29))])).toHaveLength(1)
    expect(buildRecertificationAlerts([cert(hoursFromNow(24 * 45))])).toHaveLength(0)
  })

  it("ignores rows with no name or no parseable date", () => {
    expect(
      buildRecertificationAlerts([
        { name: "", valid_until: hoursFromNow(1) },
        { name: "X", valid_until: "not a date" },
        { name: "Y" },
        null,
        "nope",
      ])
    ).toHaveLength(0)
  })

  it("returns nothing when certifications is not an array", () => {
    expect(buildRecertificationAlerts(null)).toEqual([])
    expect(buildRecertificationAlerts({})).toEqual([])
  })
})
