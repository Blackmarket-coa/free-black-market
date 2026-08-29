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
  let versionRows = 0
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
      // Manifest-bearing seeds (W3) get a resolvable manifest URL; the path is
      // relative because the seed can't know the deploy's public base — the
      // publish bridge writes absolute URLs for third-party rows.
      ...(p.manifest ? { manifest_url: `/store/plugins/${p.slug}/manifest` } : {}),
    }
    if (existing) {
      await registry.updatePluginListings({ id: existing.id, ...payload })
    } else {
      await registry.createPluginListings(payload)
    }
    upserted++

    // W3: record the version history row behind manifest-bearing seeds.
    // Idempotent — (slug, version) already recorded is skipped, so reseeding
    // never violates version immutability. First-party seeds are unsigned
    // (signature_envelope null is legal per the contract doc).
    if (p.manifest) {
      const [row] = await registry.listPluginListings({ slug: p.slug })
      const [existingVersion] = await registry.listPluginVersions({
        slug: p.slug,
        version: p.version,
      })
      if (!existingVersion) {
        await registry.createPluginVersions({
          plugin_listing_id: row?.id ?? null,
          slug: p.slug,
          version: p.version,
          min_host_version: p.minHostVersion ?? null,
          max_host_version: p.maxHostVersion ?? null,
          manifest: p.manifest,
          manifest_url: `/store/plugins/${p.slug}/manifest`,
          code_sha256:
            typeof p.manifest.sha256 === "string" ? p.manifest.sha256 : null,
          published_at: new Date(),
        })
        versionRows++
      }
    }
  }

  logger.info(
    `[seed-plugins] upserted ${upserted} plugins (${versionRows} new version rows)`
  )
  logger.info("[seed-plugins] done")
}
