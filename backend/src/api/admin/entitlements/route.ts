import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ENTITLEMENT_MODULE,
  EntitlementKind,
  EntitlementSource,
} from "../../../modules/entitlement"
import type EntitlementModuleService from "../../../modules/entitlement/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const filters: Record<string, unknown> = {}
  for (const k of [
    "customer_id",
    "customer_external_id",
    "feature_key",
    "status",
    "kind",
    "source_order_id",
    "source_subscription_id",
  ]) {
    const v = req.query[k]
    if (typeof v === "string" && v.length > 0) filters[k] = v
  }
  const entitlements = await service.listEntitlements(filters)
  return res.json({ entitlements, count: entitlements.length })
}

type CreateBody = {
  customer_id?: string
  customer_external_id?: string
  product_id?: string
  variant_id?: string
  feature_key: string
  kind?: EntitlementKind
  source?: EntitlementSource
  source_order_id?: string
  source_subscription_id?: string
  expires_at?: string | null
  metadata?: Record<string, unknown>
}

export async function POST(req: MedusaRequest<CreateBody>, res: MedusaResponse) {
  const body = (req.validatedBody || req.body) as CreateBody
  if (!body?.feature_key) {
    return res.status(400).json({ message: "feature_key is required" })
  }
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const created = await service.grant({
    customer_id: body.customer_id ?? null,
    customer_external_id: body.customer_external_id ?? null,
    product_id: body.product_id ?? null,
    variant_id: body.variant_id ?? null,
    feature_key: body.feature_key,
    kind: body.kind,
    source: body.source ?? EntitlementSource.MANUAL,
    source_order_id: body.source_order_id ?? null,
    source_subscription_id: body.source_subscription_id ?? null,
    expires_at: body.expires_at ? new Date(body.expires_at) : null,
    metadata: body.metadata ?? null,
  })
  return res.status(201).json({ entitlement: created })
}
