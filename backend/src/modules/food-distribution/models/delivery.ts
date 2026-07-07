import { model } from "@medusajs/framework/utils"

/**
 * Delivery Status
 * 
 * Comprehensive status tracking for food deliveries
 */
export enum DeliveryStatus {
  // Initial
  PENDING = "PENDING",                    // Waiting for assignment
  ASSIGNED = "ASSIGNED",                  // Courier assigned
  
  // Pickup Phase
  COURIER_EN_ROUTE_PICKUP = "COURIER_EN_ROUTE_PICKUP",
  COURIER_ARRIVED_PICKUP = "COURIER_ARRIVED_PICKUP",
  WAITING_FOR_ORDER = "WAITING_FOR_ORDER", // Order not ready yet
  ORDER_PICKED_UP = "ORDER_PICKED_UP",
  
  // Delivery Phase
  EN_ROUTE_DELIVERY = "EN_ROUTE_DELIVERY",
  ARRIVED_AT_DESTINATION = "ARRIVED_AT_DESTINATION",
  ATTEMPTING_DELIVERY = "ATTEMPTING_DELIVERY",
  
  // Completion
  DELIVERED = "DELIVERED",
  DELIVERED_TO_NEIGHBOR = "DELIVERED_TO_NEIGHBOR",
  DELIVERED_TO_SAFE_PLACE = "DELIVERED_TO_SAFE_PLACE",
  
  // Issues
  DELIVERY_FAILED = "DELIVERY_FAILED",
  CUSTOMER_NOT_AVAILABLE = "CUSTOMER_NOT_AVAILABLE",
  WRONG_ADDRESS = "WRONG_ADDRESS",
  REFUSED = "REFUSED",
  RETURNED_TO_PRODUCER = "RETURNED_TO_PRODUCER",
  
  // Special
  CANCELLED = "CANCELLED",
}

/**
 * Delivery Priority
 */
export enum DeliveryPriority {
  STANDARD = "STANDARD",
  EXPRESS = "EXPRESS",
  SCHEDULED = "SCHEDULED",
  ASAP = "ASAP",
  BATCH = "BATCH",        // Part of a batch delivery
  VOLUNTEER = "VOLUNTEER", // Volunteer-powered (flexible timing)
}

/**
 * Proof of Delivery Type
 */
export enum ProofType {
  SIGNATURE = "SIGNATURE",
  PHOTO = "PHOTO",
  PIN_CODE = "PIN_CODE",
  NONE = "NONE",
  RECIPIENT_CONFIRMATION = "RECIPIENT_CONFIRMATION",
}

/**
 * FoodDelivery Model
 * 
 * Tracks the delivery of food orders with real-time status,
 * location tracking, and proof of delivery.
 */
export const FoodDelivery = model.define("food_delivery", {
  id: model.id().primaryKey(),
  
  // Delivery number (human readable)
  delivery_number: model.text().unique(),
  
  // Link to order
  order_id: model.text(),
  
  // Producer (pickup location)
  producer_id: model.text(),
  
  // Assigned courier
  courier_id: model.text().nullable(),
  
  // Status
  status: model.enum(DeliveryStatus).default(DeliveryStatus.PENDING),
  status_history: model.json().nullable(), // [{ status, timestamp, location?, note? }]
  
  // Priority
  priority: model.enum(DeliveryPriority).default(DeliveryPriority.STANDARD),
  
  // Pickup Location
  pickup_address: model.text(),
  pickup_latitude: model.float().nullable(),
  pickup_longitude: model.float().nullable(),
  pickup_instructions: model.text().nullable(),
  pickup_contact_name: model.text().nullable(),
  pickup_contact_phone: model.text().nullable(),
  
  // Delivery Location
  delivery_address: model.text(),
  delivery_latitude: model.float().nullable(),
  delivery_longitude: model.float().nullable(),
  delivery_instructions: model.text().nullable(),
  recipient_name: model.text(),
  recipient_phone: model.text().nullable(),
  
  // Allow leaving at door (contactless)
  contactless_delivery: model.boolean().default(false),
  leave_at_door: model.boolean().default(false),
  safe_place_description: model.text().nullable(),
  
  // Timing (created_at/updated_at are implicit)
  assigned_at: model.dateTime().nullable(),
  
  // Pickup timing
  estimated_pickup_at: model.dateTime().nullable(),
  courier_departed_for_pickup_at: model.dateTime().nullable(),
  courier_arrived_at_pickup_at: model.dateTime().nullable(),
  picked_up_at: model.dateTime().nullable(),
  
  // Delivery timing
  estimated_delivery_at: model.dateTime().nullable(),
  departed_for_delivery_at: model.dateTime().nullable(),
  arrived_at_delivery_at: model.dateTime().nullable(),
  delivered_at: model.dateTime().nullable(),
  
  // Distance & Time
  estimated_distance_miles: model.float().nullable(),
  actual_distance_miles: model.float().nullable(),
  estimated_duration_minutes: model.number().nullable(),
  actual_duration_minutes: model.number().nullable(),
  
  // Route tracking (GPS breadcrumbs)
  // [{ lat, lng, timestamp, speed?, heading? }]
  route_tracking: model.json().nullable(),
  last_known_latitude: model.float().nullable(),
  last_known_longitude: model.float().nullable(),
  last_location_update: model.dateTime().nullable(),
  
  // Proof of Delivery
  proof_type: model.enum(ProofType).default(ProofType.NONE),
  proof_photo_url: model.text().nullable(),
  proof_signature_url: model.text().nullable(),
  proof_pin_code: model.text().nullable(),
  proof_recipient_name: model.text().nullable(),
  proof_notes: model.text().nullable(),
  
  // Temperature Control
  requires_hot: model.boolean().default(false),
  requires_cold: model.boolean().default(false),
  temperature_logged: model.json().nullable(), // [{ temp, timestamp }]
  
  // Fees & Tips
  delivery_fee: model.bigNumber().default(0),
  courier_tip: model.bigNumber().default(0),
  courier_earnings: model.bigNumber().default(0),
  
  // For batch deliveries
  batch_id: model.text().nullable(),
  batch_sequence: model.number().nullable(),
  
  // Issues
  has_issue: model.boolean().default(false),
  issue_type: model.text().nullable(),
  issue_description: model.text().nullable(),
  issue_reported_at: model.dateTime().nullable(),
  issue_resolved_at: model.dateTime().nullable(),
  
  // Ratings
  customer_rating: model.number().nullable(),
  customer_feedback: model.text().nullable(),
  courier_rating_of_customer: model.number().nullable(),
  courier_rating_of_producer: model.number().nullable(),
  
  // Attempt tracking
  delivery_attempts: model.number().default(0),
  max_attempts: model.number().default(3),
  
  // Rescheduling
  rescheduled: model.boolean().default(false),
  rescheduled_from_id: model.text().nullable(),
  reschedule_reason: model.text().nullable(),
  
  // Workflow integration
  workflow_transaction_id: model.text().nullable(),
  
  // Metadata
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["delivery_number"], name: "IDX_food_delivery_number" },
    { on: ["order_id"], name: "IDX_food_delivery_order" },
    { on: ["producer_id"], name: "IDX_food_delivery_producer" },
    { on: ["courier_id"], name: "IDX_food_delivery_courier" },
    { on: ["status"], name: "IDX_food_delivery_status" },
    { on: ["batch_id"], name: "IDX_food_delivery_batch" },
    { on: ["created_at"], name: "IDX_food_delivery_created" },
  ])

/**
 * DeliveryEvent Model
 * 
 * Detailed event log for delivery tracking
 */
export const DeliveryEvent = model.define("food_delivery_event", {
  id: model.id().primaryKey(),
  
  delivery: model.belongsTo(() => FoodDelivery, { mappedBy: "events" }),
  
  // Event type
  event_type: model.text(), // "status_change", "location_update", "communication", "issue"
  
  // Timestamp
  occurred_at: model.dateTime(),
  
  // Location at time of event
  latitude: model.float().nullable(),
  longitude: model.float().nullable(),
  
  // Event data
  previous_status: model.text().nullable(),
  new_status: model.text().nullable(),
  
  // Actor
  actor_type: model.enum(["COURIER", "PRODUCER", "CUSTOMER", "SYSTEM", "ADMIN"]).default("SYSTEM"),
  actor_id: model.text().nullable(),
  
  // Details
  description: model.text().nullable(),
  metadata: model.json().nullable(),
})

/**
 * DeliveryBatch Model
 * 
 * Group multiple deliveries for efficient routing
 */
export const DeliveryBatch = model.define("food_delivery_batch", {
  id: model.id().primaryKey(),
  
  // Batch identification
  batch_number: model.text().unique(),
  
  // Assigned courier
  courier_id: model.text().nullable(),
  
  // Status
  status: model.enum(["PLANNING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).default("PLANNING"),
  
  // Timing (created_at/updated_at are implicit)
  started_at: model.dateTime().nullable(),
  completed_at: model.dateTime().nullable(),
  
  // Optimized route
  // [{ delivery_id, sequence, estimated_arrival }]
  optimized_route: model.json().nullable(),
  
  // Stats
  total_deliveries: model.number().default(0),
  completed_deliveries: model.number().default(0),
  total_distance_miles: model.float().nullable(),
  total_duration_minutes: model.number().nullable(),
  
  // For food bank / mutual aid batch runs
  is_community_run: model.boolean().default(false),
  community_org_id: model.text().nullable(),
  
  // Notes
  notes: model.text().nullable(),
})

/**
 * DeliveryZone Model
 * 
 * Define delivery zones for routing and pricing
 */
export const DeliveryZone = model.define("food_delivery_zone", {
  id: model.id().primaryKey(),
  
  name: model.text(),
  code: model.text().unique(),
  
  // Zone definition (GeoJSON polygon)
  boundary: model.json(), // GeoJSON Polygon
  
  // Center point for distance calculations
  center_latitude: model.float(),
  center_longitude: model.float(),
  
  // Pricing
  base_delivery_fee: model.bigNumber().default(0),
  per_mile_fee: model.bigNumber().default(0),
  minimum_order: model.bigNumber().nullable(),
  
  // Coverage
  active: model.boolean().default(true),
  priority: model.number().default(0),
  
  // Service hours
  service_hours: model.json().nullable(),
  
  // Stats
  avg_delivery_time_minutes: model.number().nullable(),
  active_couriers: model.number().default(0),

  // Ownership — the seller who created this zone. Used to authorize
  // update/delete on the /vendor/delivery-zones routes so a vendor cannot
  // mutate or delete a zone another vendor created. Nullable for legacy zones
  // created before ownership tracking (those are treated as admin-managed and
  // not mutable via the vendor routes).
  created_by_seller_id: model.text().nullable(),
})
