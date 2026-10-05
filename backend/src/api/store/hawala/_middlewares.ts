import { authenticate } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import {
  storeHawalaBankAccountRateLimiter,
  storeHawalaInvestRateLimiter,
  storeHawalaMoneyRateLimiter,
  storeHawalaReadRateLimiter,
} from "../../../shared/rate-limiter"

/**
 * Store hawala middleware routes, spread into `src/api/middlewares.ts`.
 *
 * This file was `middlewares.ts` and Medusa never loaded it: the framework's
 * MiddlewareFileLoader reads only the `middlewares.ts` at the root of each api
 * source dir and does not recurse. The leading underscore says "imported by the
 * root, not discovered", and `src/api/__tests__/nested-middlewares.unit.spec.ts`
 * fails if a nested file is not.
 *
 * Authentication. Every handler below already answers 401 without a customer
 * (the framework puts OPTIONAL customer auth on all of /store, so
 * `auth_context` is present when a valid token is sent). These entries make the
 * requirement explicit at the edge, so a handler that forgets its own check is
 * not reachable anonymously. A middleware 401 answers `{ message:
 * "Unauthorized" }` where the handlers answered `{ error: ... }`; the
 * storefront reads either.
 *
 * Deliberately NOT here:
 *   - `/store/hawala/pools*` (GET listing) stays public, and
 *     `/store/hawala/pools/:id/contributions` stays guest-capable — the handler
 *     records a guest nonce when there is no actor. A required authenticate on
 *     either would lock out callers the design admits. Neither carries the
 *     read limiter either (see the last entries).
 *   - `/store/hawala/investments*` authentication lives in the root file, in the
 *     SAME entry as its INVESTMENT_POOLS_V1 flag and after it, so the dark
 *     surface still answers 404 feature_disabled to an anonymous caller rather
 *     than revealing itself with a 401. Two entries would leave the order to the
 *     route sorter.
 *   - No feature flag on wallet/deposit/withdraw/bank-accounts/transactions.
 *     Whether they should carry one is an operator decision, not this file's.
 *
 * Rate limits are the budgets the dead file declared (see shared/rate-limiter.ts).
 */
const requireCustomer = authenticate("customer", ["bearer", "session"])

export const storeHawalaMiddlewareRoutes: MiddlewareRoute[] = [
  {
    matcher: "/store/hawala/wallet",
    middlewares: [requireCustomer],
  },
  {
    matcher: "/store/hawala/bank-accounts",
    middlewares: [requireCustomer],
  },
  {
    matcher: "/store/hawala/transactions",
    middlewares: [requireCustomer],
  },
  {
    // Money path: ACH pull into the caller's USER_WALLET. The handler 401s via
    // requireCustomerId; the dead file only rate-limited it.
    matcher: "/store/hawala/deposit",
    middlewares: [requireCustomer],
  },
  {
    // Money path: ACH push out of the caller's USER_WALLET. Same as deposit.
    matcher: "/store/hawala/withdraw",
    middlewares: [requireCustomer],
  },
  {
    matcher: "/store/hawala/deposit",
    method: "POST",
    middlewares: [storeHawalaMoneyRateLimiter],
  },
  {
    matcher: "/store/hawala/withdraw",
    method: "POST",
    middlewares: [storeHawalaMoneyRateLimiter],
  },
  {
    matcher: "/store/hawala/investments",
    method: "POST",
    middlewares: [storeHawalaInvestRateLimiter],
  },
  {
    // As declared: the link-session start. `/bank-accounts/link` was never in
    // the declared budget.
    matcher: "/store/hawala/bank-accounts",
    method: "POST",
    middlewares: [storeHawalaBankAccountRateLimiter],
  },
  // The read budget, on the customer's OWN reads only. The dead file declared
  // it as `/store/hawala/**` GET, which would also cover the public pools
  // listing. Every storefront hawala call now arrives from the Next server
  // (the `hawalaRequest` server action), so an anonymous read keys on THAT
  // server's address: on `/store/hawala/pools` the 30/min would be one bucket
  // for every signed-out visitor on the site. These four all require a
  // customer, so a request that gets past auth keys on the actor.
  ...["/store/hawala/wallet", "/store/hawala/bank-accounts", "/store/hawala/transactions", "/store/hawala/investments"].map(
    (matcher): MiddlewareRoute => ({
      matcher,
      method: "GET",
      middlewares: [storeHawalaReadRateLimiter],
    })
  ),
]
