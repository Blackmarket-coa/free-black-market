import { z } from "zod"

export const deliveryBoundarySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(z.array(z.tuple([z.number(), z.number()])))
    .min(1, "Boundary must include at least one polygon ring"),
})

export const serviceHoursSchema = z
  .record(
    z.string(),
    z.object({
      open: z.string().regex(/^\d{2}:\d{2}$/),
      close: z.string().regex(/^\d{2}:\d{2}$/),
    })
  )
  .optional()

// The zone's fields with no defaults. Create adds the defaults below; update
// is the partial of these, not of the create schema.
const deliveryZoneFields = {
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).regex(/^[A-Z0-9-]+$/),
  boundary: deliveryBoundarySchema,
  center_latitude: z.number().min(-90).max(90),
  center_longitude: z.number().min(-180).max(180),
  radius_miles: z.number().min(0).max(100).optional(),
  base_delivery_fee: z.number().min(0),
  per_mile_fee: z.number().min(0),
  minimum_order: z.number().min(0).optional(),
  service_hours: serviceHoursSchema,
  active: z.boolean(),
  priority: z.number().int().min(0),
}

export const createDeliveryZoneSchema = z.object({
  ...deliveryZoneFields,
  base_delivery_fee: deliveryZoneFields.base_delivery_fee.default(0),
  per_mile_fee: deliveryZoneFields.per_mile_fee.default(0),
  active: deliveryZoneFields.active.default(true),
  priority: deliveryZoneFields.priority.default(0),
})

/**
 * A partial update: a field that is absent stays absent.
 *
 * This used to be `createDeliveryZoneSchema.partial()`, and zod 4 keeps a
 * field's `.default()` under `.partial()`. So every update that left out a fee,
 * `active` or `priority` came back with `base_delivery_fee: 0`,
 * `per_mile_fee: 0`, `active: true` and `priority: 0`, and
 * `/vendor/delivery-zones/:id` wrote them: renaming a zone made its delivery
 * free and re-activated it if it had been switched off.
 */
export const updateDeliveryZoneSchema = z.object(deliveryZoneFields).partial().extend({
  service_hours: serviceHoursSchema.nullable().optional(),
  minimum_order: z.number().min(0).nullable().optional(),
})

export const deliveryZoneCheckRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  producer_id: z.string().optional(),
})
