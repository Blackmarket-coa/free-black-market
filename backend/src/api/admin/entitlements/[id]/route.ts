import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../modules/entitlement/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "id is required" })
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const [entitlement] = await service.listEntitlements({ id })
  if (!entitlement) return res.status(404).json({ message: "Not found" })
  return res.json({ entitlement })
}

type PatchBody = {
  status?: string
  expires_at?: string | null
  metadata?: Record<string, unknown>
}

export async function PATCH(req: MedusaRequest<PatchBody>, res: MedusaResponse) {
  const { id } = req.params
  const body = (req.validatedBody || req.body) as PatchBody
  if (!id) return res.status(400).json({ message: "id is required" })
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const update: Record<string, unknown> = { id }
  if (body.status) update.status = body.status
  if (body.expires_at !== undefined) {
    update.expires_at = body.expires_at ? new Date(body.expires_at) : null
  }
  if (body.metadata !== undefined) update.metadata = body.metadata
  const [updated] = await service.updateEntitlements([update as any])
  return res.json({ entitlement: updated })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "id is required" })
  const service = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const reason = (req.query.reason as string) || "admin_revoke"
  const updated = await service.revoke(id, reason)
  return res.json({ entitlement: updated, revoked: true })
}
