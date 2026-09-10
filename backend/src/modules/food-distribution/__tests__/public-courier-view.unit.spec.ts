import { publicCourierView, publicCourierViewAll } from "../public-view"

/**
 * What a stranger may see of a courier (D10-5, the courier half).
 *
 * `GET /store/couriers` and `/store/couriers/:id` are unauthenticated and
 * serialized the `food_courier` row verbatim. For people doing gig delivery
 * work that meant publishing their email, phone, live coordinates, licence
 * plate, home-ish service-area centre, weekly schedule, documents,
 * background-check status, total earnings and pending payout — plus an
 * emergency contact's name and phone, belonging to someone who never
 * interacted with this platform at all.
 *
 * D10-5 deferred the remaining unauthenticated reads for want of an access
 * ruling. This one needed none: the repository had already declared the
 * public courier field set twice — the "Courier info (public only)"
 * projection on `/food-deliveries/:id/track`, and the model's note that
 * `display_name` is "What customers see" — and nothing in the storefront,
 * either panel, or the integration tests calls these two endpoints, so
 * there was no working surface to break.
 */
const ROW = {
  id: "cour_1",
  first_name: "Ada",
  last_name: "Okonkwo",
  display_name: "Ada O.",
  email: "ada@example.com",
  phone: "+15551234567",
  courier_type: "INDEPENDENT",
  vehicle_type: "EBIKE",
  vehicle_description: "Blue cargo e-bike",
  license_plate: "XYZ-1234",
  status: "AVAILABLE",
  active: true,
  verified: true,
  current_latitude: 41.8781,
  current_longitude: -87.6298,
  location_updated_at: "2026-09-10T12:00:00.000Z",
  service_area_center_lat: 41.9,
  service_area_center_lng: -87.7,
  service_area_radius_miles: 6,
  weekly_schedule: { monday: { start: "09:00", end: "17:00" } },
  average_rating: 4.8,
  total_ratings: 52,
  on_time_percentage: 96,
  total_deliveries: 312,
  successful_deliveries: 305,
  total_earnings: 421050,
  pending_payout: 8200,
  hawala_account_id: "hac_1",
  background_check_passed: true,
  background_check_date: "2026-01-04T00:00:00.000Z",
  drivers_license_verified: true,
  insurance_verified: false,
  documents: [{ kind: "insurance", url: "https://example.com/doc.pdf" }],
  emergency_contact_name: "Chidi Okonkwo",
  emergency_contact_phone: "+15559876543",
  avatar_url: "https://example.com/ada.jpg",
  has_insulated_bag: true,
  has_hot_bag: false,
  has_cold_storage: false,
  max_weight_lbs: 40,
  max_orders_simultaneous: 3,
  preferred_zones: ["Downtown"],
  accepts_cash_orders: true,
  accepts_donation_deliveries: true,
  owner_id: "cus_1",
  owner_type: "customer",
  metadata: { internal_note: "prefers morning runs" },
  created_at: "2026-01-01T00:00:00.000Z",
}

const PRIVATE_FIELDS = [
  "last_name",
  "email",
  "phone",
  "current_latitude",
  "current_longitude",
  "location_updated_at",
  "service_area_center_lat",
  "service_area_center_lng",
  "weekly_schedule",
  "license_plate",
  "vehicle_description",
  "total_earnings",
  "pending_payout",
  "hawala_account_id",
  "background_check_passed",
  "background_check_date",
  "drivers_license_verified",
  "insurance_verified",
  "documents",
  "emergency_contact_name",
  "emergency_contact_phone",
  "owner_id",
  "owner_type",
  "metadata",
]

describe("publicCourierView", () => {
  it("publishes none of the personal or financial columns", () => {
    const view = publicCourierView(ROW)
    for (const field of PRIVATE_FIELDS) {
      expect(view).not.toHaveProperty(field)
    }
  })

  it("never leaks an emergency contact — a third party who never opted in", () => {
    const view = JSON.stringify(publicCourierView(ROW))
    expect(view).not.toContain("Chidi")
    expect(view).not.toContain("+15559876543")
  })

  it("never leaks a live position", () => {
    const view = publicCourierView(ROW)
    expect(view.current_latitude).toBeUndefined()
    expect(view.current_longitude).toBeUndefined()
    // The customer a delivery belongs to gets the breadcrumb through
    // /food-deliveries/:id/track, which knows who is asking.
  })

  it("publishes the radius without its centre", () => {
    // A radius alone locates nobody and is the half a requester needs; the
    // centre is usually where the courier lives.
    const view = publicCourierView(ROW)
    expect(view.service_area_radius_miles).toBe(6)
    expect(view).not.toHaveProperty("service_area_center_lat")
  })

  it("publishes reputation and capability, which is what a courier list is for", () => {
    const view = publicCourierView(ROW)
    expect(view).toMatchObject({
      id: "cour_1",
      vehicle_type: "EBIKE",
      status: "AVAILABLE",
      average_rating: 4.8,
      total_deliveries: 312,
      has_insulated_bag: true,
      preferred_zones: ["Downtown"],
    })
  })

  it("publishes `verified` but not the screening facts behind it", () => {
    // The platform saying it has checked someone is a different act from
    // republishing that person's background-check and licence status to
    // anonymous callers.
    const view = publicCourierView(ROW)
    expect(view.verified).toBe(true)
    expect(view).not.toHaveProperty("background_check_passed")
    expect(view).not.toHaveProperty("drivers_license_verified")
  })

  it("uses display_name, the column the model calls 'what customers see'", () => {
    expect(publicCourierView(ROW).display_name).toBe("Ada O.")
  })

  it("falls back to the first name when display_name is unset", () => {
    // Matches /food-deliveries/:id/track, which shows `name: first_name`.
    expect(publicCourierView({ ...ROW, display_name: null }).display_name).toBe("Ada")
    expect(publicCourierView({ ...ROW, display_name: "" }).display_name).toBe("Ada")
  })

  it("is an allow-list, so a column added tomorrow is private by default", () => {
    // The reverse default is how this row came to publish emergency contacts.
    const view = publicCourierView({ ...ROW, ssn: "000-00-0000" })
    expect(view).not.toHaveProperty("ssn")
  })

  it("omits a field the row does not carry rather than inventing a null", () => {
    const { average_rating: _omitted, ...withoutRating } = ROW
    expect(publicCourierView(withoutRating)).not.toHaveProperty("average_rating")
  })

  it("projects every row in a list", () => {
    const views = publicCourierViewAll([ROW, { ...ROW, id: "cour_2" }])
    expect(views).toHaveLength(2)
    for (const view of views) {
      expect(view).not.toHaveProperty("email")
    }
  })

  it("tolerates an empty list", () => {
    expect(publicCourierViewAll([])).toEqual([])
  })
})
