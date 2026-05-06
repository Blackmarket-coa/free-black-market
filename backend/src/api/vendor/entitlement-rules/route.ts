import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  ENTITLEMENT_MODULE,
  EntitlementKind,
} from "../../../modules/entitlement"
import type EntitlementModuleService from "../../../modules/entitlement/service"

async function resolveSellerId(req: MedusaRequest, actorId?: string): Promise<string | undefined> {
  if (!actorId) return undefined
  if (!actorId.startsWith("mem_")) return actorId
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const memberResult = await pgConnection.raw(
      `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
      [actorId]
    )
    return memberResult.rows?.[0]?.seller_id || actorId
  } catch {
    return actorId
  }
}

async function sellerOwnsProduct(req: MedusaRequest, sellerId: string, productId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sellerProducts } = await query.graph({
    entity: "seller",
    fields: ["products.id"],
    filters: { id: sellerId },
  })
  const owned = sellerProducts?.[0]?.products?.map((p: any) => p.id) || []
  return owned.includes(productId)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const rules = await service.listEntitlementGrantRules({ seller_id: sellerId })
  return res.json({ rules, count: rules.length })
}

type Body = {
  product_id?: string
  variant_id?: string
  feature_key: string
  kind?: EntitlementKind
  duration_days?: number | null
  enabled?: boolean
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.validatedBody || req.body) as Body
  if (!body?.feature_key) {
    return res.status(400).json({ message: "feature_key is required" })
  }
  if (!body.product_id && !body.variant_id) {
    return res.status(400).json({ message: "product_id or variant_id is required" })
  }
  if (body.product_id && !(await sellerOwnsProduct(req, sellerId, body.product_id))) {
    return res.status(403).json({ message: "You do not own this product" })
  }

  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const [created] = await service.createEntitlementGrantRules([
    {
      seller_id: sellerId,
      product_id: body.product_id ?? null,
      variant_id: body.variant_id ?? null,
      feature_key: body.feature_key,
      kind: body.kind ?? EntitlementKind.OTHER,
      duration_days: body.duration_days ?? null,
      enabled: body.enabled ?? true,
    },
  ])
  return res.status(201).json({ rule: created })
}
