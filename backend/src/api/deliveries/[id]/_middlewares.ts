import { authenticate } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import { isDeliveryRestaurant } from "../../utils/is-delivery-restaurant"
import { isDeliveryDriver } from "../../utils/is-delivery-driver"
import { isDeliveryParticipant } from "../../utils/is-delivery-participant"

/**
 * `/deliveries/:id/*` authentication, spread into `src/api/middlewares.ts`.
 *
 * This file was `middlewares.ts`, which Medusa never loaded, and it was the
 * ONLY auth these routes had. `/deliveries` sits outside /store, /admin and
 * /vendor, so no framework or Mercur default covers it: until this was
 * imported, an anonymous caller holding a delivery id could advance the
 * handle-delivery workflow (accept, prepare, ready — which leads into
 * createFulfillmentStep — pick-up, complete). The declared guards are wired as
 * written; the two ownership guards now answer forbidden() (403) for every
 * refusal, including a delivery that does not exist.
 *
 * `/subscribe` (a read-only event stream of the delivery workflow) was never
 * declared at all. It is wired fail-closed here to the delivery's own
 * restaurant admin or assigned driver (isDeliveryParticipant), and refused for a
 * delivery with no transaction id, whose subscription would hear every
 * handle-delivery transaction. No first-party client calls any
 * `/deliveries/:id/*` route (vendor-panel uses /vendor/deliveries).
 */
export const deliveryMiddlewareRoutes: MiddlewareRoute[] = [
  // restaurant routes
  {
    matcher: "/deliveries/:id/accept",
    middlewares: [authenticate("restaurant", "bearer"), isDeliveryRestaurant],
  },
  {
    matcher: "/deliveries/:id/prepare",
    middlewares: [authenticate("restaurant", "bearer"), isDeliveryRestaurant],
  },
  {
    matcher: "/deliveries/:id/ready",
    middlewares: [authenticate("restaurant", "bearer"), isDeliveryRestaurant],
  },
  // driver routes
  {
    // No ownership guard, as declared: claiming is how a driver becomes the
    // delivery's driver.
    matcher: "/deliveries/:id/claim",
    middlewares: [authenticate("driver", "bearer")],
  },
  {
    matcher: "/deliveries/:id/pick-up",
    middlewares: [authenticate("driver", "bearer"), isDeliveryDriver],
  },
  {
    matcher: "/deliveries/:id/complete",
    middlewares: [authenticate("driver", "bearer"), isDeliveryDriver],
  },
  {
    matcher: "/deliveries/:id/subscribe",
    middlewares: [authenticate(["restaurant", "driver"], "bearer"), isDeliveryParticipant],
  },
]
