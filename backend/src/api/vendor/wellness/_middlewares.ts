import type { MiddlewareRoute } from "@medusajs/framework/http"
import {
  vendorWellnessReadRateLimiter,
  vendorWellnessTestSendRateLimiter,
} from "../../../shared/rate-limiter"

/**
 * Vendor wellness rate limits, spread into `src/api/middlewares.ts`.
 *
 * This file was `middlewares.ts`, which Medusa never loaded, so neither limit
 * ever ran. Budgets carried over as declared. The dead file's
 * `authenticate("seller", ...)` on `/vendor/wellness/**` is not carried over:
 * Mercur already requires seller auth on `/vendor/*`, so it is redundant (see
 * `vendor/hawala/_middlewares.ts`).
 */
export const vendorWellnessMiddlewareRoutes: MiddlewareRoute[] = [
  {
    // Sending Blackout DMs hits the homeserver — keep test sends strict.
    matcher: "/vendor/wellness/automations/test",
    method: "POST",
    middlewares: [vendorWellnessTestSendRateLimiter],
  },
  {
    matcher: "/vendor/wellness/**",
    method: "GET",
    middlewares: [vendorWellnessReadRateLimiter],
  },
]
