import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DONATION_MODULE } from "../../../../modules/donation"
import DonationModuleService from "../../../../modules/donation/service"

type Body = {
  name: string
  slug: string
  description?: string
  website?: string
  verification_status?: "pending" | "verified" | "rejected"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const beneficiaries = await service.listBeneficiaries(true)
  res.status(200).json({ beneficiaries })
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const service = req.scope.resolve<DonationModuleService>(DONATION_MODULE)
  const body = req.validatedBody || req.body

  const beneficiary = await service.createDonationBeneficiaries({
    name: body.name,
    slug: body.slug,
    description: body.description,
    website: body.website,
    verification_status: body.verification_status || "pending",
  })

  res.status(200).json({ beneficiary })
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

  res.status(200).json({ beneficiary })
}
