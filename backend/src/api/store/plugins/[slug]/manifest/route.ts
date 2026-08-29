import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../modules/plugin-registry/service"
import { PluginStatus } from "../../../../../modules/plugin-registry/models/plugin-listing"

/**
 * GET /store/plugins/:slug/manifest[?version=X.Y.Z] — the canonical
 * distribution manifest JSON of a recorded version (latest by default).
 * This is the document `plugin_listing.manifest_url` points at; installers
 * hash it (canonical JSON) against `signature_envelope.manifestSha256`.
 * 404 for plugins with no recorded versions (legacy manifest-less seeds).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const slug = String(req.params.slug)
  const registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)

  const plugin = await registry.getBySlug(slug)
  if (!plugin || (plugin as { status?: string }).status === PluginStatus.DRAFT) {
    return res.status(404).json({ message: `Plugin '${slug}' not found` })
  }

  const requested = typeof req.query.version === "string" ? req.query.version : null
  let row: { manifest?: Record<string, unknown> | null } | null = null
  if (requested) {
    const versions = (await registry.listVersions(slug, { includeYanked: true })) as Array<{
      version: string
      manifest?: Record<string, unknown> | null
    }>
    row = versions.find((v) => v.version === requested) ?? null
  } else {
    row = (await registry.getLatestVersion(slug)) as {
      manifest?: Record<string, unknown> | null
    } | null
  }

  if (!row || !row.manifest) {
    return res.status(404).json({
      message: requested
        ? `No manifest recorded for '${slug}'@${requested}`
        : `No manifest recorded for '${slug}'`,
    })
  }

  res.setHeader("cache-control", "public, max-age=300")
  return res.json(row.manifest)
}
