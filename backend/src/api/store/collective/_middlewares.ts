import { authenticate } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"

/**
 * Store collective (demand pools, bargaining groups, buyer networks) write
 * authentication, spread into `src/api/middlewares.ts`.
 *
 * This file was `middlewares.ts`, which Medusa never loaded — only the root
 * `src/api/middlewares.ts` is read — so none of these entries ever ran. Every
 * handler they cover already answers 401 without a customer (the framework's
 * optional /store auth supplies `auth_context` when a token is sent), so making
 * them live changes no outcome for a signed-in or signed-out caller; it puts
 * the requirement at the edge as declared. Reads stay public. The `/join` and
 * `/escrow` entries carry no method, as declared: those routes serve only POST
 * and DELETE, and both 401 in the handler.
 *
 * No feature flag on `/store/collective*` (see the root file's Buyer Center
 * comment): gating the buyer side would hide pools from the people they gather.
 */
export const storeCollectiveMiddlewareRoutes: MiddlewareRoute[] = [
  // Authenticated routes - require customer login for write operations
  {
    matcher: "/store/collective/demand-pools",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/demand-pools/:id",
    method: "PATCH",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/demand-pools/:id/join",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/demand-pools/:id/bounties",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    // Money-moving: releases bounty escrow to the assignee. Declared here
    // rather than relying on the handler's `auth_context` read, which only
    // works because Medusa happens to populate it for /store by default.
    matcher: "/store/collective/demand-pools/:id/bounties/*/milestones",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/demand-pools/:id/bounties/*/claim",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/demand-pools/:id/proposals/*/vote",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/demand-pools/:id/escrow",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    // Offering a trade and accepting one both attach to a person.
    matcher: "/store/collective/demand-pools/:id/barter",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/demand-pools/:id/barter/*/accept",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    // Decides where a buyer's own escrowed pledge goes — must be the
    // authenticated participant, never an anonymous or third-party caller.
    matcher: "/store/collective/demand-pools/:id/surplus-disposition",
    method: "PUT",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/bargaining-groups",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/bargaining-groups/:id",
    method: "PATCH",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/bargaining-groups/:id/join",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/bargaining-groups/:id/proposals",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/bargaining-groups/:id/proposals/*/vote",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/bargaining-groups/:id/threads",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/buyer-networks",
    method: "POST",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
  {
    matcher: "/store/collective/buyer-networks/:id/join",
    middlewares: [authenticate("customer", ["bearer", "session"])],
  },
]
