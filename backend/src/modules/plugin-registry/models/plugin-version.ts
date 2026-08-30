import { model } from "@medusajs/framework/utils"

/**
 * Immutable per-version record behind a `plugin_listing` (W3): the signed
 * distribution manifest, its envelope, and the artifact hashes for one
 * published `(slug, version)`. `plugin_listing.version` stays the
 * denormalized LATEST; these rows are the history — repeat publishes of the
 * same version are idempotent only when byte-identical (`code_sha256`), and
 * `yanked_at` hides a version from resolution without deleting the record.
 *
 * Refs are soft text columns by module convention (author_seller_id
 * precedent): `plugin_listing_id` stays module-internal, `source_listing_id`
 * points at the `creator_listing` a publish originated from (provenance
 * without cross-module coupling — no link file).
 */
const PluginVersion = model
  .define("plugin_version", {
    id: model.id().primaryKey(),
    plugin_listing_id: model.text().nullable(),
    slug: model.text(),
    version: model.text(),
    min_host_version: model.text().nullable(),
    max_host_version: model.text().nullable(),
    /** The canonical distribution manifest (what manifest_url serves). */
    manifest: model.json().nullable(),
    manifest_url: model.text().nullable(),
    signed_bundle_url: model.text().nullable(),
    /** Blackout-format distribution envelope; null for unsigned first-party seeds. */
    signature_envelope: model.json().nullable(),
    signing_key_id: model.text().nullable(),
    code_sha256: model.text().nullable(),
    source_listing_id: model.text().nullable(),
    published_at: model.dateTime(),
    yanked_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["slug", "version"], unique: true, name: "UQ_plugin_version_slug_version" },
    { on: ["slug"], name: "IDX_plugin_version_slug" },
  ])

export default PluginVersion
