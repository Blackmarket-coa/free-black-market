import type { MiddlewareRoute } from "@medusajs/framework/http"
import {
  vendorHawalaMoneyRateLimiter,
  vendorHawalaPoolCreateRateLimiter,
  vendorHawalaReadRateLimiter,
} from "../../../shared/rate-limiter"

/**
 * Vendor hawala rate limits, spread into `src/api/middlewares.ts`.
 *
 * This file was `middlewares.ts`, which Medusa never loaded (only the root
 * `src/api/middlewares.ts` is read), so none of these limits ever ran. The
 * budgets are carried over as declared.
 *
 * The dead file also declared `authenticate("seller", ...)` on
 * `/vendor/hawala/**`. That is NOT carried over: it is redundant. Mercur's
 * b2c-core already requires seller auth on `/vendor/*`, and the root's
 * `/vendor/**` ensureSellerContext resolves the seller (and rewrites
 * `auth_context.actor_id` to the member id). Re-running authenticate after it
 * would only replace the context that guard built.
 */
export const vendorHawalaMiddlewareRoutes: MiddlewareRoute[] = [
  {
    matcher: "/vendor/hawala/payouts",
    method: "POST",
    middlewares: [vendorHawalaMoneyRateLimiter],
  },
  {
    // Also flag-gated VENDOR_ADVANCES_V1 in the root file; the flag runs first.
    matcher: "/vendor/hawala/advances",
    method: "POST",
    middlewares: [vendorHawalaMoneyRateLimiter],
  },
  {
    // Also flag-gated INVOICING_V1 + plan-gated in the root file.
    matcher: "/vendor/hawala/payments",
    method: "POST",
    middlewares: [vendorHawalaMoneyRateLimiter],
  },
  {
    // Under the root's INVESTMENT_POOLS_V1 `/vendor/hawala/pools*` flag.
    matcher: "/vendor/hawala/pools/*/withdraw",
    method: "POST",
    middlewares: [vendorHawalaMoneyRateLimiter],
  },
  {
    matcher: "/vendor/hawala/pools",
    method: "POST",
    middlewares: [vendorHawalaPoolCreateRateLimiter],
  },
  {
    matcher: "/vendor/hawala/**",
    method: "GET",
    middlewares: [vendorHawalaReadRateLimiter],
  },
]
