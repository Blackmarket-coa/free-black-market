import { model } from "@medusajs/framework/utils"

/**
 * AssetKind
 *
 * Taxonomy node (hierarchical, dot-separated slug). Source of truth in
 * `backend/src/modules/asset-graph/seed/asset-kinds.ts`; this table is
 * the denormalized, query-friendly view seeded from that catalog at
 * boot — same pattern as `playbook` and `listing-type`.
 *
 * Persistence (a migration) lands in v0.1. v0 is schema-only.
 *
 * See `docs/ASSET_GRAPH.md`.
 */
const AssetKind = model.define("asset_kind", {
  id: model.id().primaryKey(),

  /** Dot-separated slug (e.g. `tool.vehicle.truck`, `output-capacity.compost`). */
  slug: model.text().unique(),

  /**
   * Top-level category. One of:
   *   physical-artifact | space | skill | time |
   *   capital | credential | network-reach | output-capacity.
   */
  category: model.text(),

  /** Parent slug, or null for taxonomy roots. */
  parent_slug: model.text().nullable(),

  display_name: model.text(),

  /**
   * JSON encoding of the zod attribute schema declarations of this kind
   * must satisfy. Stored as JSON for portability; reconstituted in code
   * from `seed/asset-kinds.ts`.
   */
  attribute_schema: model.json(),

  /**
   * Default sensitivity tier applied to declarations of this kind when
   * the declarer doesn't override (and the active manifest's
   * sensitivity_floor doesn't raise it).
   */
  default_sensitivity_tier: model.text(),

  /** Default lifecycle for declarations of this kind. */
  default_lifecycle: model.text(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["slug"], name: "IDX_asset_kind_slug" },
  { on: ["category"], name: "IDX_asset_kind_category" },
  { on: ["parent_slug"], name: "IDX_asset_kind_parent_slug" },
])

export default AssetKind
