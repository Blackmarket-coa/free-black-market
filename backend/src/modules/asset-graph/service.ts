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
import {
  matchManifest,
  proposalsFromReport,
  type ManifestMatchReport,
  type MatcherDeclaration,
  type MatchProposalPayload,
} from "./matcher"

/**
 * AssetGraphService
 *
 * Catalog readers, taxonomy lookups, the wildcard slug matcher, and
 * the manifest-matching engine. Persistence-backed methods write
 * through the auto-generated MedusaService accessors.
 *
 * Catalog reads (`getManifest`, `getAssetKind`) intentionally bypass
 * the DB — same pattern as `playbook.service.getRecipe` — because the
 * code-side catalog is the source of truth and is always available
 * regardless of seed state.
 *
 * The matcher entry points (`runMatchManifest`, `proposeMatches`) are
 * thin wrappers around the pure functions in `./matcher`. They exist
 * on the service so they can be DI-resolved, but the algorithm itself
 * has no service dependency and is unit-testable in isolation.
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

  // ── matcher ─────────────────────────────────────────────────────────

  /**
   * Run the pure matcher against an explicit declaration pool. Useful
   * for unit tests, dry-runs, and the upcoming UI preview path. Does
   * not read from or write to the DB.
   */
  runMatchManifest(
    slug: ManifestSlug,
    pool: ReadonlyArray<MatcherDeclaration>
  ): ManifestMatchReport {
    return matchManifest(getManifest(slug), pool)
  }

  /**
   * Generate match proposals for a manifest from the live DB pool of
   * declarations. When `persist` is true, writes the proposals to the
   * `match_proposal` table and returns the persisted rows; otherwise
   * returns the in-memory payloads.
   *
   * Default behavior is non-persistent so callers can preview the
   * proposal set before committing — preserves Posture A's discipline
   * of "no balance-affecting write without explicit opt-in."
   */
  async proposeMatches(args: {
    manifest_slug: ManifestSlug
    persist?: boolean
  }): Promise<{
    report: ManifestMatchReport
    proposals: MatchProposalPayload[]
    persisted?: any[]
  }> {
    const manifest = getManifest(args.manifest_slug)
    const declarations = (await this.listAssetDeclarations(
      { revoked_at: null } as any,
      { take: null } as any
    )) as MatcherDeclaration[]

    const report = matchManifest(manifest, declarations)
    const proposals = proposalsFromReport(report)

    if (!args.persist) {
      return { report, proposals }
    }

    const persisted = await this.createMatchProposals(proposals as any[])
    return { report, proposals, persisted }
  }
}

export default AssetGraphService
