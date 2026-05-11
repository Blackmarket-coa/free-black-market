import { MedusaService } from "@medusajs/framework/utils"
import {
  AssetKind,
  AssetDeclaration,
  Attestation,
  ProjectManifest,
  ProjectInstance,
  MatchProposal,
  SettlementRecord,
} from "./models"
import {
  PROJECT_MANIFESTS,
  MANIFEST_SLUGS,
  getManifest,
  type ManifestSlug,
} from "./manifests"
import type { ProjectManifestRecipe } from "./manifests/types"
import {
  ASSET_KIND_CATALOG,
  getAssetKind,
  matchesKindSlug,
  type AssetKindDefinition,
} from "./seed/asset-kinds"

/**
 * AssetGraphService
 *
 * Thin DI surface for v0: catalog readers, taxonomy lookups, and the
 * wildcard slug matcher. Persistence-backed methods (create
 * declarations, propose matches, emit settlement records) land in
 * v0.1 alongside the matching engine.
 *
 * Catalog reads (`getManifest`, `getAssetKind`) intentionally bypass
 * the DB — same pattern as `playbook.service.getRecipe` — because the
 * code-side catalog is the source of truth and is always available
 * regardless of seed state.
 */
class AssetGraphService extends MedusaService({
  AssetKind,
  AssetDeclaration,
  Attestation,
  ProjectManifest,
  ProjectInstance,
  MatchProposal,
  SettlementRecord,
}) {
  // ── manifest catalog ────────────────────────────────────────────────

  listManifestSlugs(): ManifestSlug[] {
    return MANIFEST_SLUGS.slice()
  }

  listManifests(): ProjectManifestRecipe[] {
    return MANIFEST_SLUGS.map((slug) => PROJECT_MANIFESTS[slug])
  }

  getManifestRecipe(slug: ManifestSlug): ProjectManifestRecipe {
    return getManifest(slug)
  }

  // ── asset kind catalog ──────────────────────────────────────────────

  listAssetKindCatalog(): ReadonlyArray<AssetKindDefinition> {
    return ASSET_KIND_CATALOG
  }

  getAssetKindDefinition(slug: string): AssetKindDefinition {
    return getAssetKind(slug)
  }

  /**
   * Whether a concrete declared slug satisfies a manifest's required
   * slug (which may carry a single trailing `.*` wildcard).
   *
   * Manifest writes `tool.*`, declarations write `tool.power-tool.drill`;
   * this is the function that decides they match at proposal time.
   */
  kindSlugMatches(required: string, declared: string): boolean {
    return matchesKindSlug(required, declared)
  }
}

export default AssetGraphService
