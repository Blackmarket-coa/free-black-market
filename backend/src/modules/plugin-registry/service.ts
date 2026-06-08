import { MedusaService } from "@medusajs/framework/utils"
import { PluginListing } from "./models"
import { PluginStatus } from "./models/plugin-listing"

/**
 * Plugin ecosystem (§16) module service. Owns the discovery catalog of
 * installable extensions/analytics/automation tools and the install counter.
 * The actual per-seller enablement lives on seller-extension's
 * `enabled_extensions`; this module is the registry + counts.
 */
class PluginRegistryService extends MedusaService({
  PluginListing,
}) {
  async listPublished(filters?: { category?: string; limit?: number }) {
    const where: Record<string, unknown> = { status: PluginStatus.PUBLISHED }
    if (filters?.category) {
      where.category = filters.category
    }
    return this.listPluginListings(where, {
      take: filters?.limit || 100,
      order: { install_count: "DESC", name: "ASC" },
    })
  }

  async getBySlug(slug: string) {
    const [plugin] = await this.listPluginListings({ slug })
    return plugin || null
  }

  /** Increment install count (called when a seller installs the plugin). */
  async incrementInstallCount(slug: string) {
    const [plugin] = await this.listPluginListings({ slug })
    if (!plugin) {
      throw new Error(`Plugin "${slug}" not found`)
    }
    await this.updatePluginListings({
      id: plugin.id,
      install_count: Number(plugin.install_count) + 1,
    })
    const [updated] = await this.listPluginListings({ id: plugin.id })
    return updated
  }
}

export default PluginRegistryService
