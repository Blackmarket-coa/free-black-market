import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../../../modules/asset-graph"
import type AssetGraphService from "../../../../../../modules/asset-graph/service"
import type { ManifestSlug } from "../../../../../../modules/asset-graph/manifests"

/**
 * POST /admin/asset-graph/manifests/:slug/match
 *
 * Body: { persist?: boolean }
 *
 * Runs the matcher against the live declaration pool for one
 * manifest. Default is dry-run (no MatchProposal rows written);
 * pass `persist: true` to commit the proposals.
 *
 * Returns the full per-slot report plus the proposals that would
 * be written. The report makes "why isn't this manifest matching?"
 * answerable: each slot lists its candidates and a satisfied flag.
 */
type MatchBody = { persist?: boolean }

export async function POST(
  req: MedusaRequest<MatchBody>,
  res: MedusaResponse
) {
  const slug = req.params.slug
  if (!slug) return res.status(400).json({ message: "slug is required" })

  const body = (req.validatedBody || req.body || {}) as MatchBody
  const persist = body.persist === true

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)
  try {
    const result = await (service as AssetGraphService).proposeMatches({
      manifest_slug: slug as ManifestSlug,
      persist,
    })
    return res.json({
      manifest_slug: slug,
      persisted: persist,
      report: {
        satisfied: result.report.satisfied,
        slot_reports: result.report.slot_reports,
        candidate_operators: result.report.candidate_operators,
      },
      proposals: result.proposals,
      persisted_rows: result.persisted ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "match failed"
    // getManifest throws on unknown slug; surface as 404 for that path.
    if (message.includes("Unknown project manifest slug")) {
      return res.status(404).json({ message })
    }
    return res.status(500).json({ message })
  }
}
