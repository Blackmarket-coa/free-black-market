import { model } from "@medusajs/framework/utils"

/**
 * AssetDeclaration
 *
 * A member declaring they have, control, or offer an asset of a given
 * kind. This is the intake layer that lets `ProjectManifest`-driven
 * matching propose projects to members rather than asking members to
 * pick a product offering up front.
 *
 * `member_id` anchors to the BMC Member identity that owns the Stellar
 * account on the hawala-ledger spine (per docs/COMPOSITION_LAYER.md).
 *
 * `attributes` is JSON validated at write time against the
 * `AssetKind.attribute_schema` for `asset_kind_id`.
 *
 * Sensitivity tier is stored here; cryptographic enforcement
 * (room-scoped / match-only redaction) is deferred to a follow-up
 * branch. v0 establishes the schema slot.
 */
const AssetDeclaration = model.define("asset_declaration", {
  id: model.id().primaryKey(),

  /** BMC Member id (FK kept loose in v0 to avoid coupling to a specific identity module). */
  member_id: model.text(),

  /** Asset kind id (FK to `asset_kind.id`). */
  asset_kind_id: model.text(),

  /** Cached kind slug — denormalized for read paths and migration safety. */
  kind_slug: model.text(),

  /**
   * JSON payload validated against `AssetKind.attribute_schema` for the
   * referenced kind. Schema-driven so adding fields to a kind doesn't
   * require a migration here.
   */
  attributes: model.json(),

  /**
   * One of: public | member-visible | room-scoped | match-only.
   * Crypto enforcement of room-scoped/match-only is deferred.
   */
  sensitivity_tier: model.text(),

  /**
   * One of: one-time | recurring | durable-commitment | perishable |
   * exhaustible-borrow-return.
   */
  lifecycle: model.text(),

  /** Availability windows / on-demand / exhaustion counters. */
  availability: model.json().nullable(),

  /**
   * Geography of the asset. JSON `{ type, radius_m?, polygon?, point? }`.
   * v0 stores JSON; PostGIS adoption deferred.
   */
  geography: model.json().nullable(),

  /** individual | collective | vote-weighted | consensus. */
  governance_model: model.text().default("individual"),

  /** When the declaration was withdrawn (null while active). */
  revoked_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["member_id"], name: "IDX_asset_declaration_member_id" },
  { on: ["asset_kind_id"], name: "IDX_asset_declaration_asset_kind_id" },
  { on: ["kind_slug"], name: "IDX_asset_declaration_kind_slug" },
  { on: ["sensitivity_tier"], name: "IDX_asset_declaration_sensitivity_tier" },
  { on: ["lifecycle"], name: "IDX_asset_declaration_lifecycle" },
])

export default AssetDeclaration
