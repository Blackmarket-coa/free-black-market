import { model } from "@medusajs/framework/utils"

export enum PluginCategory {
  MARKETPLACE_EXTENSION = "MARKETPLACE_EXTENSION",
  ANALYTICS = "ANALYTICS",
  AUTOMATION = "AUTOMATION",
}

export enum PluginStatus {
  PUBLISHED = "PUBLISHED",
  DRAFT = "DRAFT",
  DEPRECATED = "DEPRECATED",
}

/**
 * A listing in the Black Market plugin ecosystem (§16): a marketplace
 * extension, analytics tool, or automation tool a vendor can discover and
 * install. Installation is recorded against the seller's `enabled_extensions`
 * (seller-extension module) — this table is the discovery catalog.
 */
const PluginListing = model
  .define("plugin_listing", {
    id: model.id().primaryKey(),
    slug: model.text().unique(),
    name: model.text().searchable(),
    category: model
      .enum(Object.values(PluginCategory))
      .default(PluginCategory.MARKETPLACE_EXTENSION),
    description: model.text(),
    /** Optional author seller; null for first-party plugins. */
    author_seller_id: model.text().nullable(),
    manifest_url: model.text().nullable(),
    icon_url: model.text().nullable(),
    version: model.text().default("1.0.0"),
    status: model
      .enum(Object.values(PluginStatus))
      .default(PluginStatus.PUBLISHED),
    install_count: model.number().default(0),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["slug"], name: "IDX_plugin_listing_slug" },
    { on: ["category"], name: "IDX_plugin_listing_category" },
    { on: ["status"], name: "IDX_plugin_listing_status" },
  ])

export default PluginListing
