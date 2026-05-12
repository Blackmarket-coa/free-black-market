import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { ASSET_KIND_CATALOG } from "../modules/asset-graph/seed/asset-kinds"
import {
  PROJECT_MANIFESTS,
  MANIFEST_SLUGS,
} from "../modules/asset-graph/manifests"
import { ASSET_GRAPH_MODULE } from "../modules/asset-graph"

/**
 * Seed the asset-graph catalog tables from their in-code source of
 * truth. Idempotent: re-running upserts any drift between code and DB.
 *
 *   asset_kind          ← seed/asset-kinds.ts (ASSET_KIND_CATALOG)
 *   project_manifest    ← manifests/*.ts      (PROJECT_MANIFESTS)
 *
 * The zod `attribute_schema` on each kind is not portable JSON, so the
 * DB column holds a pointer back to the in-code definition. Service
 * reads (`getAssetKindDefinition`, `listAssetKindCatalog`) bypass the
 * DB and return the canonical zod-bearing object directly; the DB row
 * exists for joins, indexed lookups, and future-proofing.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/seed-asset-graph.ts
 *
 * See `docs/ASSET_GRAPH.md`.
 */
export default async function seedAssetGraph({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const assetGraphService: any = container.resolve(ASSET_GRAPH_MODULE)

  logger.info("[seed-asset-graph] Starting seed for asset-graph catalog")

  // ── asset_kind ──────────────────────────────────────────────────
  let kindsUpserted = 0
  for (const def of ASSET_KIND_CATALOG) {
    const [existing] = await assetGraphService.listAssetKinds({
      slug: def.slug,
    })
    const payload = {
      slug: def.slug,
      category: def.category,
      parent_slug: def.parent_slug,
      display_name: def.display_name,
      // Zod schemas aren't JSON; code is the source of truth.
      attribute_schema: {
        _note:
          "code-of-truth in backend/src/modules/asset-graph/seed/asset-kinds.ts",
        _kind_slug: def.slug,
      },
      default_sensitivity_tier: def.default_sensitivity_tier,
      default_lifecycle: def.default_lifecycle,
    }
    if (existing) {
      await assetGraphService.updateAssetKinds({
        id: existing.id,
        ...payload,
      })
    } else {
      await assetGraphService.createAssetKinds(payload)
    }
    kindsUpserted++
  }
  logger.info(`[seed-asset-graph] Upserted ${kindsUpserted} asset kinds`)

  // ── project_manifest ────────────────────────────────────────────
  let manifestsUpserted = 0
  for (const slug of MANIFEST_SLUGS) {
    const recipe = PROJECT_MANIFESTS[slug]
    const [existing] = await assetGraphService.listProjectManifests({ slug })
    const payload = {
      slug: recipe.slug,
      version: recipe.version,
      display_name: recipe.display_name,
      description: recipe.description,
      required_asset_kinds: recipe.required_asset_kinds,
      settlement_rails: recipe.settlement_rails,
      playbook_slug: recipe.playbook_slug,
      listing_type_slugs: recipe.listing_type_slugs,
      governance_model: recipe.governance_model,
      sensitivity_floor: recipe.sensitivity_floor,
      surface: recipe.surface,
      is_active: true,
    }
    if (existing) {
      await assetGraphService.updateProjectManifests({
        id: existing.id,
        ...payload,
      })
    } else {
      await assetGraphService.createProjectManifests(payload)
    }
    manifestsUpserted++
  }
  logger.info(
    `[seed-asset-graph] Upserted ${manifestsUpserted} project manifests`
  )

  logger.info("[seed-asset-graph] Done")
}
