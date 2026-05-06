import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { SERVICE_PROGRAM_MODULE } from "../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../modules/service-program/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../modules/marketplace-webhooks/service"

const ApplySchema = z.object({
  program_id: z.string().min(1).max(64),
  proposed_unit_price_cents: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  proposed_capacity: z.number().int().min(0).max(1_000_000).optional().nullable(),
  proposed_lead_time_days: z.number().int().min(0).max(365).optional().nullable(),
  sample_portfolio_urls: z.array(z.string().url()).max(20).optional().nullable(),
  pitch: z.string().max(4000).optional().nullable(),
})

/**
 * GET /v1/seller/services/applications — list this service vendor's
 * applications.
 *
 * POST /v1/seller/services/applications — apply to a service program /
 * claim an open bounty.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  const apps = await service.listServiceApplications({ service_seller_id: sellerId })
  return res.status(200).json({ applications: apps })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const parsed = ApplySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid application payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  try {
    const application = await service.applyToProgram({
      programId: parsed.data.program_id,
      serviceSellerId: sellerId,
      proposedUnitPriceCents: parsed.data.proposed_unit_price_cents ?? null,
      proposedCapacity: parsed.data.proposed_capacity ?? null,
      proposedLeadTimeDays: parsed.data.proposed_lead_time_days ?? null,
      samplePortfolioUrls: parsed.data.sample_portfolio_urls ?? null,
      pitch: parsed.data.pitch ?? null,
    })

    try {
      const webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
      const programs = await service.listServicePrograms({ id: parsed.data.program_id })
      const program = programs[0]
      if (program) {
        await webhooks.dispatch("service.application.submitted", program.vendor_id, {
          application_id: application.id,
          program_id: parsed.data.program_id,
          service_seller_id: sellerId,
        })
      }
    } catch (err) {
      console.error("[service-applications] webhook dispatch failed", err)
    }

    return res.status(201).json({ application })
  } catch (err) {
    return res.status(409).json({ message: (err as Error).message, type: "conflict" })
  }
}
