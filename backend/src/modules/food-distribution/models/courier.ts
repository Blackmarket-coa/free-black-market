import { model } from "@medusajs/framework/utils"

/**
 * Courier Types
 * 
 * Different types of delivery personnel in the network
 */
export enum CourierType {
  INDEPENDENT = "INDEPENDENT",    // Gig worker / freelance
  EMPLOYEE = "EMPLOYEE",          // Works for a producer
  VOLUNTEER = "VOLUNTEER",        // Volunteer (mutual aid, food bank)
  COMMUNITY = "COMMUNITY",        // Community member helping out
  COOP_MEMBER = "COOP_MEMBER",    // Courier cooperative member
}

/**
 * Vehicle Types
 */
export enum VehicleType {
  CAR = "CAR",
  BIKE = "BIKE",
  EBIKE = "EBIKE",
  MOTORCYCLE = "MOTORCYCLE",
  SCOOTER = "SCOOTER",
  WALKING = "WALKING",
  VAN = "VAN",
  TRUCK = "TRUCK",
}

/**
 * Courier Status
 */
export enum CourierStatus {
  OFFLINE = "OFFLINE",
  AVAILABLE = "AVAILABLE",
  ON_DELIVERY = "ON_DELIVERY",
  RETURNING = "RETURNING",
  BREAK = "BREAK",
}

/**
 * Courier Model
 * 
 * Delivery personnel - supports independent gig workers,
 * employees, volunteers, and coop members
 */
export const Courier = model.define("food_courier", {
  id: model.id().primaryKey(),
  
  // Identity
  first_name: model.text(),
  last_name: model.text(),
  display_name: model.text().nullable(), // What customers see
  email: model.text(),
  phone: model.text(),
  
  // Type & Affiliation
  courier_type: model.enum(CourierType).default(CourierType.INDEPENDENT),
  
  // If affiliated with specific producer(s) - JSON array of producer IDs
  affiliated_producer_ids: model.json().nullable(),
  
  // If part of a cooperative
  cooperative_id: model.text().nullable(),
  
  // Current Status
  status: model.enum(CourierStatus).default(CourierStatus.OFFLINE),
  last_status_update: model.dateTime().nullable(),
  
  // Current Location (updated periodically)
  current_latitude: model.float().nullable(),
  current_longitude: model.float().nullable(),
  location_updated_at: model.dateTime().nullable(),
  
  // Vehicle Information
  vehicle_type: model.enum(VehicleType).default(VehicleType.CAR),
  vehicle_description: model.text().nullable(), // "Red Honda Civic"
  license_plate: model.text().nullable(),
  
  // Capacity
  max_orders_simultaneous: model.number().default(3),
  has_insulated_bag: model.boolean().default(false),
  has_hot_bag: model.boolean().default(false),
  has_cold_storage: model.boolean().default(false),
  max_weight_lbs: model.float().nullable(),
  
  // Service Area
  service_area_center_lat: model.float().nullable(),
  service_area_center_lng: model.float().nullable(),
  service_area_radius_miles: model.float().nullable(),
  preferred_zones: model.json().nullable(), // ["Downtown", "East Side"]
  
  // Availability
  // Format: { monday: { start: "09:00", end: "17:00", available: true }, ... }
  weekly_schedule: model.json().nullable(),
  
  // Stats
  total_deliveries: model.number().default(0),
  successful_deliveries: model.number().default(0),
  average_rating: model.float().nullable(),
  total_ratings: model.number().default(0),
  on_time_percentage: model.float().nullable(),
  
  // Earnings (for independent/coop)
  total_earnings: model.bigNumber().default(0),
  pending_payout: model.bigNumber().default(0),
  
  // Hawala Integration
  hawala_account_id: model.text().nullable(),
  
  // Verification
  verified: model.boolean().default(false),
  background_check_passed: model.boolean().default(false),
  background_check_date: model.dateTime().nullable(),
  drivers_license_verified: model.boolean().default(false),
  insurance_verified: model.boolean().default(false),
  
  // Documents (JSON array of document records)
  documents: model.json().nullable(),
  
  // Media
  avatar_url: model.text().nullable(),
  
  // Emergency Contact
  emergency_contact_name: model.text().nullable(),
  emergency_contact_phone: model.text().nullable(),
  
  // Preferences
  accepts_cash_orders: model.boolean().default(true),
  accepts_donation_deliveries: model.boolean().default(true), // Volunteer for food bank runs
  preferred_distance_miles: model.float().nullable(),
  
  // Active Status
  active: model.boolean().default(true),
  deactivated_at: model.dateTime().nullable(),
  deactivation_reason: model.text().nullable(),

  // Ownership — the authenticated account that created/manages this courier.
  // Nullable so pre-migration couriers are grandfathered (any authenticated
  // actor may still manage them); new couriers are stamped at creation and
  // ownership-enforced on update/claim/deactivate.
  owner_id: model.text().nullable(),
  owner_type: model.text().nullable(), // "customer" | "seller" | "driver"

  // Metadata
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["email"], name: "IDX_courier_email" },
    { on: ["phone"], name: "IDX_courier_phone" },
    { on: ["status"], name: "IDX_courier_status" },
    { on: ["courier_type"], name: "IDX_courier_type" },
    { on: ["active"], name: "IDX_courier_active" },
  ])

/**
 * Courier Shift
 * 
 * Track scheduled shifts for couriers
 */
export const CourierShift = model.define("food_courier_shift", {
  id: model.id().primaryKey(),
  
  courier: model.belongsTo(() => Courier, { mappedBy: "shifts" }),
  
  // Schedule
  scheduled_start: model.dateTime(),
  scheduled_end: model.dateTime(),
  
  // Actual times
  actual_start: model.dateTime().nullable(),
  actual_end: model.dateTime().nullable(),
  
  // Status
  status: model.enum(["SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED", "NO_SHOW"]).default("SCHEDULED"),
  
  // Zone/Area
  assigned_zone: model.text().nullable(),
  
  // Stats for this shift
  deliveries_completed: model.number().default(0),
  earnings_this_shift: model.bigNumber().default(0),
  
  // Notes
  notes: model.text().nullable(),
})
