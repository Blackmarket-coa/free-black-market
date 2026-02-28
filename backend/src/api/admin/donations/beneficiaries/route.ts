import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"

type Body = {
  id?: string
  name: string
  slug: string
  description?: string
  website?: string
  verification_status?: "pending" | "verified" | "rejected"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const context = (req as any).storefront_context || null
  const all = await service.listBeneficiaries(true)

  const beneficiaries = context?.storefront_id
    ? all.filter((b) => String((b.metadata as any)?.storefront_id || "") === context.storefront_id)
    : all

  return res.status(200).json({ beneficiaries, storefront_context: context })
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const context = (req as any).storefront_context || null
  const body = req.validatedBody || req.body

  const beneficiary = await service.createDonationBeneficiaries({
    name: body.name,
    slug: body.slug,
    description: body.description,
    website: body.website,
    verification_status: body.verification_status || "pending",
    metadata: {
      storefront_id: context?.storefront_id,
      organization_id: context?.organization_id,
    },
  })

  return res.status(200).json({ beneficiary })
}

export async function PATCH(req: MedusaRequest<Body & { id: string }>, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const body = req.validatedBody || req.body

  const beneficiary = await service.updateDonationBeneficiaries({
    id: body.id,
    name: body.name,
    slug: body.slug,
    description: body.description,
    website: body.website,
    verification_status: body.verification_status,
  })

  return res.status(200).json({ beneficiary })
}
