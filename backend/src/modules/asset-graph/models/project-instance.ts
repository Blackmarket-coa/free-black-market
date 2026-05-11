import { model } from "@medusajs/framework/utils"

/**
 * ProjectInstance
 *
 * A deployment of a `ProjectManifest` in a specific geography with a
 * specific operator and member set. v0: schema only; deployment
 * lifecycle (provisioning, activating, archiving) lands in v0.1
 * alongside the matching engine.
 *
 * Settlement records emitted by the project carry `project_instance_id`
 * so the existing hawala-ledger entries can be scoped back to the
 * concrete project they belong to.
 */
const ProjectInstance = model.define("project_instance", {
  id: model.id().primaryKey(),

  /** Slug of the `project_manifest` this instance deploys. */
  manifest_slug: model.text(),

  /** Operator member id (the seller / coordinator anchor). */
  operator_member_id: model.text(),

  /**
   * Member ids of all participants. Stored as JSON in v0 to avoid
   * introducing a join table before the matching engine lands.
   */
  member_ids: model.json(),

  /** JSON `{ type, radius_m?, polygon?, point? }`. */
  geography: model.json().nullable(),

  /** draft | active | paused | archived. */
  state: model.text().default("draft"),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["manifest_slug"], name: "IDX_project_instance_manifest_slug" },
  {
    on: ["operator_member_id"],
    name: "IDX_project_instance_operator_member_id",
  },
  { on: ["state"], name: "IDX_project_instance_state" },
])

export default ProjectInstance
