import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { SUPPLIER_FORWARDING_MODULE } from "../../../modules/supplier-forwarding"
import SupplierForwardingModuleService from "../../../modules/supplier-forwarding/service"
import { SupplierContactMethod } from "../../../modules/supplier-forwarding/models"

const upsertSchema = z.object({
  supplier_id: z.string().min(1),
  display_name: z.string().min(1),
  contact_method: z.enum(["email", "api", "manual"]),
  contact_email: z.string().email().optional().nullable(),
  api_base_url: z.string().url().optional().nullable(),
  api_key: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)
  const profiles = await service.listSupplierProfiles({})
  res.json({ supplier_profiles: profiles })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)
  const body = upsertSchema.parse(req.body)

  const payload = {
    ...body,
    contact_method: body.contact_method as SupplierContactMethod,
  }

  const [existing] = await service.listSupplierProfiles({ supplier_id: body.supplier_id })

  if (existing) {
    const profile = await service.updateSupplierProfiles({ id: existing.id, ...payload })
    return res.json({ supplier_profile: profile })
  }

  const profile = await service.createSupplierProfiles(payload)
  return res.status(201).json({ supplier_profile: profile })
}
