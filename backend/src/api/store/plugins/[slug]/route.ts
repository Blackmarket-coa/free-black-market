import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PLUGIN_REGISTRY_MODULE } from "../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../modules/plugin-registry/service"
import { isInstallable } from "../../../../modules/plugin-registry/compat"
import { PluginStatus } from "../../../../modules/plugin-registry/models/plugin-listing"
import { PLATFORM_VERSION } from "../../../../shared/platform-version"

type VersionRow = {
  version: string
  published_at: Date | string
  code_sha256?: string | null
  signed_bundle_url?: string | null
  signature_envelope?: Record<string, unknown> | null
  manifest_url?: string | null
  yanked_at?: Date | string | null
}

const versionView = (row: VersionRow) => ({
  version: row.version,
  published_at: row.published_at,
  code_sha256: row.code_sha256 ?? null,
  signed_bundle_url: row.signed_bundle_url ?? null,
  signature_envelope: row.signature_envelope ?? null,
  manifest_url: row.manifest_url ?? null,
})

/**
 * GET /store/plugins/:slug — public plugin detail (W3):
 * the catalog row (author id reduced to a presence flag — privacy posture),
 * the compat-gate verdict against this host, the latest resolvable version
 * (with its distribution envelope for installers), and the full non-yanked
 * history under `?include=versions`.
 *
 * DEPRECATED plugins stay visible (existing installs need the metadata);
 * DRAFT rows are not exposed.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const slug = String(req.params.slug)
  const registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)

  const plugin = await registry.getBySlug(slug)
  if (!plugin || (plugin as { status?: string }).status === PluginStatus.DRAFT) {
    return res.status(404).json({ message: `Plugin '${slug}' not found` })
  }

  const compat = isInstallable(
    {
      status: (plugin as { status?: string | null }).status,
      min_host_version: (plugin as { min_host_version?: string | null }).min_host_version,
      max_host_version: (plugin as { max_host_version?: string | null }).max_host_version,
    },
    PLATFORM_VERSION
  )

  const latest = (await registry.getLatestVersion(slug)) as VersionRow | null

  const body: Record<string, unknown> = {
    slug: plugin.slug,
    name: plugin.name,
    category: plugin.category,
    description: plugin.description,
    status: plugin.status,
    version: plugin.version,
    min_host_version: plugin.min_host_version ?? null,
    max_host_version: plugin.max_host_version ?? null,
    manifest_url: plugin.manifest_url ?? null,
    icon_url: plugin.icon_url ?? null,
    install_count: Number(plugin.install_count),
    has_third_party_author: Boolean(plugin.author_seller_id),
    installable: compat.ok
      ? { ok: true }
      : { ok: false, code: compat.code, message: compat.message },
    host_version: PLATFORM_VERSION,
    latest_version: latest ? versionView(latest) : null,
  }

  if (String(req.query.include ?? "").split(",").includes("versions")) {
    const versions = (await registry.listVersions(slug)) as VersionRow[]
    body.versions = versions.map(versionView)
  }

  return res.json(body)
}
