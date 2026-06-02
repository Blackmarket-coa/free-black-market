import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { SERVICE_PROGRAM_MODULE } from "../../../../../modules/service-program"
import type ServiceProgramService from "../../../../../modules/service-program/service"
import {
  ServiceCategory,
  ServiceProgramType,
  ServicePricingModel,
} from "../../../../../modules/service-program/models"

const slugRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

const CreateSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z.string().regex(slugRegex),
  description: z.string().max(4000).optional().nullable(),
  deliverable_spec: z.record(z.string(), z.unknown()).optional().nullable(),
  acceptance_criteria: z.record(z.string(), z.unknown()).optional().nullable(),
  service_category: z.nativeEnum(ServiceCategory),
  program_type: z.nativeEnum(ServiceProgramType),
  pricing_model: z.nativeEnum(ServicePricingModel),
  unit_price_cents: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  hourly_rate_cents: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  flat_price_cents: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  pool_total_cents: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  currency_code: z.string().length(3).optional(),
  min_units: z.number().int().min(0).optional().nullable(),
  max_units: z.number().int().min(0).optional().nullable(),
  deadline_at: z.string().datetime().optional().nullable(),
  budget_cap_cents: z.number().int().min(0).max(1_000_000_000_000).optional().nullable(),
  requires_kyc: z.boolean().optional(),
  min_verification_level: z.string().max(64).optional().nullable(),
  geo_allowlist: z.array(z.string().length(2)).max(250).optional().nullable(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  const programs = await service.listServicePrograms({ vendor_id: sellerId })
  return res.status(200).json({ programs })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const parsed = CreateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid program payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const service = req.scope.resolve<ServiceProgramService>(SERVICE_PROGRAM_MODULE)
  try {
    const program = await service.createProgram({
      vendorId: sellerId,
      title: parsed.data.title,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      deliverableSpec:
        (parsed.data.deliverable_spec as Record<string, unknown> | null) ?? null,
      acceptanceCriteria:
        (parsed.data.acceptance_criteria as Record<string, unknown> | null) ?? null,
      serviceCategory: parsed.data.service_category,
      programType: parsed.data.program_type,
      pricingModel: parsed.data.pricing_model,
      unitPriceCents: parsed.data.unit_price_cents ?? null,
      hourlyRateCents: parsed.data.hourly_rate_cents ?? null,
      flatPriceCents: parsed.data.flat_price_cents ?? null,
      poolTotalCents: parsed.data.pool_total_cents ?? null,
      currencyCode: parsed.data.currency_code,
      minUnits: parsed.data.min_units ?? null,
      maxUnits: parsed.data.max_units ?? null,
      deadlineAt: parsed.data.deadline_at ? new Date(parsed.data.deadline_at) : null,
      budgetCapCents: parsed.data.budget_cap_cents ?? null,
      requiresKyc: parsed.data.requires_kyc ?? false,
      minVerificationLevel: parsed.data.min_verification_level ?? null,
      geoAllowlist: parsed.data.geo_allowlist ?? null,
    })
    return res.status(201).json({ program })
  } catch (err) {
    return res.status(409).json({ message: (err as Error).message, type: "conflict" })
  }
}
