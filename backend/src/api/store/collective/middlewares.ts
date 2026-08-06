import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
  routes: [
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
  ],
})
