import { model } from "@medusajs/framework/utils"

const Membership = model.define("tenancy_membership", {
  id: model.id().primaryKey(),
  user_id: model.text(),
  organization_id: model.text(),
  storefront_id: model.text(),
  /**
   * The seller this membership belongs to, when there is one.
   *
   * Nullable because the existing memberships are keyed by `user_id` alone —
   * an org operator administering a storefront is not necessarily a seller on
   * it. It is what lets a storefront's tier floor its sellers' plan features
   * (`gates.ts`), which is otherwise unresolvable: nothing connected a seller
   * to an organization before this.
   *
   * Same shape as the `seller_id` added to `Entitlement`: additive, nullable,
   * indexed, no behavior change for rows that leave it null.
   */
  seller_id: model.text().nullable(),
  role: model.enum(["org_owner", "storefront_admin", "catalog_manager", "finance_viewer"]),
  metadata: model.json().nullable(),
})

export default Membership
