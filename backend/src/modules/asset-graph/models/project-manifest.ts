import { model } from "@medusajs/framework/utils"

/**
 * ProjectManifest
 *
 * Registry of vertical recipes the asset graph composes. Source of truth
 * in `backend/src/modules/asset-graph/manifests/*.ts`; this table is the
 * denormalized, query-friendly view seeded from that catalog at boot.
 *
 * Each manifest references existing `playbook` and `listing-type`
 * entries, so a manifest is mostly a thin declaration that says
 * "this kind of project needs these assets, settles on these rails,
 * uses this playbook, exposes these listing-types, governs this way."
 *
 * Persistence (a migration) lands in v0.1. v0 is schema-only.
 */
const ProjectManifest = model.define("project_manifest", {
  id: model.id().primaryKey(),

  /** Catalog slug (e.g. `yard-scrap-nursery`, `tool-library`). */
  slug: model.text().unique(),

  /** Semver string. */
  version: model.text(),

  display_name: model.text(),
  description: model.text(),

  /**
   * Array of `{ kind_slug, role, min_count, optional, constraints?,
   * lifecycle? }`. See `manifests/types.ts` for the zod schema.
   */
  required_asset_kinds: model.json(),

  /** Array of rails: ccr | usdc | usd | karma | hours | gift. */
  settlement_rails: model.json(),

  /** Reference into the `playbook` recipe registry. */
  playbook_slug: model.text(),

  /** Reference array into the `listing-type` catalog. */
  listing_type_slugs: model.json(),

  /** individual | collective | vote-weighted | consensus. */
  governance_model: model.text(),

  /** Minimum sensitivity tier declarations made under this manifest must respect. */
  sensitivity_floor: model.text(),

  /** commerce | refrain | threshold | blackstar. */
  surface: model.text(),

  is_active: model.boolean().default(true),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["slug"], name: "IDX_project_manifest_slug" },
  { on: ["playbook_slug"], name: "IDX_project_manifest_playbook_slug" },
  { on: ["surface"], name: "IDX_project_manifest_surface" },
  { on: ["is_active"], name: "IDX_project_manifest_is_active" },
])

export default ProjectManifest
