import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ASSET_GRAPH_MODULE } from "../../../../modules/asset-graph"
import type AssetGraphService from "../../../../modules/asset-graph/service"

/**
 * GET /store/asset-graph/declarations
 *
 * Lists the authenticated member's own declarations. Filters by
 * the auth context's actor_id — never returns another member's
 * declarations, even if the caller knows their ids.
 *
 * Query params: lifecycle, kind_slug, limit, offset.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const memberId = (req as any).auth_context?.actor_id
  if (!memberId) return res.status(401).json({ error: "Unauthorized" })

  const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)

  const filters: Record<string, unknown> = { member_id: memberId }
  if (req.query.lifecycle) filters.lifecycle = req.query.lifecycle
  if (req.query.kind_slug) filters.kind_slug = req.query.kind_slug

  const limit = req.query.limit ? Number(req.query.limit) : 20
  const offset = req.query.offset ? Number(req.query.offset) : 0

  const declarations = await (service as AssetGraphService).listAssetDeclarations(
    filters as any,
    { take: limit, skip: offset } as any
  )

  return res.json({
    declarations,
    count: Array.isArray(declarations) ? declarations.length : 0,
    limit,
    offset,
  })
}

const createBody = z.object({
  kind_slug: z.string().min(1),
  attributes: z.record(z.unknown()).default({}),
  lifecycle: z
    .enum([
      "one-time",
      "recurring",
      "durable-commitment",
      "perishable",
      "exhaustible-borrow-return",
    ])
    .optional(),
  sensitivity_tier: z
    .enum(["public", "member-visible", "room-scoped", "match-only"])
    .optional(),
  availability: z.record(z.unknown()).nullable().optional(),
  geography: z.record(z.unknown()).nullable().optional(),
  governance_model: z
    .enum(["individual", "collective", "vote-weighted", "consensus"])
    .optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
})

/**
 * POST /store/asset-graph/declarations
 *
 * Member declares an asset. The `kind_slug` must resolve in the
 * catalog; the `attributes` are validated against the kind's zod
 * attribute_schema before the row is written. Lifecycle and
 * sensitivity_tier default from the kind when omitted.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const memberId = (req as any).auth_context?.actor_id
  if (!memberId) return res.status(401).json({ error: "Unauthorized" })

  try {
    const body = createBody.parse(req.body)
    const service: any = req.scope.resolve(ASSET_GRAPH_MODULE)
    const declaration = await (service as AssetGraphService).createDeclarationFor(
      {
        member_id: memberId,
        kind_slug: body.kind_slug,
        attributes: body.attributes,
        lifecycle: body.lifecycle,
        sensitivity_tier: body.sensitivity_tier,
        availability: body.availability ?? null,
        geography: body.geography ?? null,
        governance_model: body.governance_model,
        metadata: body.metadata ?? null,
      }
    )
    return res.status(201).json({ declaration })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation failed",
        issues: err.issues,
      })
    }
    const message = err instanceof Error ? err.message : "create failed"
    // The service throws "Unknown asset kind slug: ..." on a bad slug
    // and zod throws on attribute-schema violations. Both surface as 400.
    if (message.includes("Unknown asset kind")) {
      return res.status(400).json({ error: message })
    }
    return res.status(400).json({ error: message })
  }
}
