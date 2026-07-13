import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PLUGIN_REGISTRY_MODULE } from "../modules/plugin-registry"
import { PLUGIN_SEED } from "../modules/plugin-registry/catalog"

/**
 * Seed the plugin ecosystem (§16) first-party catalog. Idempotent: upserts by
 * slug. Mirrors seed-playbooks.ts.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/seed-plugins.ts
 */
export default async function seedPlugins({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const registry: any = container.resolve(PLUGIN_REGISTRY_MODULE)

  logger.info("[seed-plugins] starting")

  let upserted = 0
  for (const p of PLUGIN_SEED) {
    const [existing] = await registry.listPluginListings({ slug: p.slug })
    const payload = {
      slug: p.slug,
      name: p.name,
      category: p.category,
      description: p.description,
      version: p.version,
      min_host_version: p.minHostVersion ?? null,
      max_host_version: p.maxHostVersion ?? null,
      status: "PUBLISHED",
    }
    if (existing) {
      await registry.updatePluginListings({ id: existing.id, ...payload })
    } else {
      await registry.createPluginListings(payload)
    }
    upserted++
  }

  logger.info(`[seed-plugins] upserted ${upserted} plugins`)
  logger.info("[seed-plugins] done")
}
