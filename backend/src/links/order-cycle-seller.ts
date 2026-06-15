/**
 * Link: Order Cycle ↔ Seller — INTENTIONALLY DISABLED.
 *
 * The order-cycle module already models the cycle↔seller association with its own
 * `order_cycle_seller` entity (`src/modules/order-cycle/models/order-cycle-seller.ts`,
 * created by `migrations/Migration20251227015616.ts`), which stores `seller_id`, `role`,
 * and `commission_rate`. Defining a *separate* Medusa module-link between OrderCycle and
 * the MercurJS seller entity makes RemoteJoiner derive the alias `order_cycle_seller`,
 * which collides with that existing module entity at `medusa build`:
 *
 *   Cannot add alias "order_cycle_seller" for "OrderCycleModuleOrderCycleSellerSellerLink".
 *   It is already defined for Service "orderCycleModuleService".
 *
 * This link was dormant until now: under MercurJS 1.5.0 the old loader silently resolved
 * the seller module to `undefined`, so the link never registered. Now that the seller
 * module resolves correctly via `loadSellerModule()`, the collision surfaces. We keep the
 * link disabled (export null, which Medusa's link loader safely skips) — the module's own
 * `order_cycle_seller` model remains the source of truth for cycle↔seller relationships.
 *
 * To expose remote-query navigation from an order cycle to the MercurJS seller *entity* in
 * the future, this must be redesigned with a non-colliding alias (it cannot reuse
 * `order_cycle_seller`).
 */
export default null
