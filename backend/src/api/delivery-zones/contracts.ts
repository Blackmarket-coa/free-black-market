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

export const createDeliveryZoneSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20).regex(/^[A-Z0-9-]+$/),
  boundary: deliveryBoundarySchema,
  center_latitude: z.number().min(-90).max(90),
  center_longitude: z.number().min(-180).max(180),
  radius_miles: z.number().min(0).max(100).optional(),
  base_delivery_fee: z.number().min(0).default(0),
  per_mile_fee: z.number().min(0).default(0),
  minimum_order: z.number().min(0).optional(),
  service_hours: serviceHoursSchema,
  active: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
})

export const updateDeliveryZoneSchema = createDeliveryZoneSchema.partial().extend({
  service_hours: serviceHoursSchema.nullable().optional(),
  minimum_order: z.number().min(0).nullable().optional(),
})

export const deliveryZoneCheckRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  producer_id: z.string().optional(),
})
