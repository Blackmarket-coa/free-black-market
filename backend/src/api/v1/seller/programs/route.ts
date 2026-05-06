import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../modules/creator-program"
import CreatorProgramService from "../../../../modules/creator-program/service"
import {
  CreatorProgramType,
  CreatorProgramAttributionModel,
} from "../../../../modules/creator-program/models"

const slugRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

const CreateProgramSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z.string().regex(slugRegex),
  description: z.string().max(4000).optional().nullable(),
  brief_markdown: z.string().max(20000).optional().nullable(),
  program_type: z.nativeEnum(CreatorProgramType),
  commission_percent: z.number().min(0).max(100).optional().nullable(),
  commission_flat_cents: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  sponsorship_flat_cents: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  pool_total_cents: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
  pool_period: z.enum(["weekly", "monthly"]).optional().nullable(),
  cookie_window_days: z.number().int().min(0).max(180).optional(),
  hold_days: z.number().int().min(0).max(180).optional(),
  attribution_model: z.nativeEnum(CreatorProgramAttributionModel).optional(),
  currency_code: z.string().length(3).optional(),
  product_ids: z.array(z.string()).max(500).optional().nullable(),
  collection_ids: z.array(z.string()).max(200).optional().nullable(),
  category_ids: z.array(z.string()).max(200).optional().nullable(),
  required_platforms: z.array(z.string().max(64)).max(16).optional().nullable(),
  min_followers: z.number().int().min(0).max(2_000_000_000).optional().nullable(),
  geo_allowlist: z.array(z.string().length(2)).max(250).optional().nullable(),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
  budget_cap_cents: z.number().int().min(0).max(1_000_000_000_000).optional().nullable(),
  requires_kyc: z.boolean().optional(),
  min_verification_level: z.string().max(64).optional().nullable(),
})

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const programs = await service.listCreatorPrograms({ vendor_id: sellerId })
  return res.status(200).json({ programs })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const parsed = CreateProgramSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid program payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  try {
    const program = await service.createProgram({
      vendorId: sellerId,
      title: parsed.data.title,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      briefMarkdown: parsed.data.brief_markdown ?? null,
      programType: parsed.data.program_type,
      commissionPercent: parsed.data.commission_percent ?? null,
      commissionFlatCents: parsed.data.commission_flat_cents ?? null,
      sponsorshipFlatCents: parsed.data.sponsorship_flat_cents ?? null,
      poolTotalCents: parsed.data.pool_total_cents ?? null,
      poolPeriod: parsed.data.pool_period ?? null,
      cookieWindowDays: parsed.data.cookie_window_days,
      holdDays: parsed.data.hold_days,
      attributionModel: parsed.data.attribution_model,
      currencyCode: parsed.data.currency_code,
      productIds: parsed.data.product_ids ?? null,
      collectionIds: parsed.data.collection_ids ?? null,
      categoryIds: parsed.data.category_ids ?? null,
      requiredPlatforms: parsed.data.required_platforms ?? null,
      minFollowers: parsed.data.min_followers ?? null,
      geoAllowlist: parsed.data.geo_allowlist ?? null,
      startsAt: parsed.data.starts_at ? new Date(parsed.data.starts_at) : null,
      endsAt: parsed.data.ends_at ? new Date(parsed.data.ends_at) : null,
      budgetCapCents: parsed.data.budget_cap_cents ?? null,
      requiresKyc: parsed.data.requires_kyc ?? false,
      minVerificationLevel: parsed.data.min_verification_level ?? null,
    })
    return res.status(201).json({ program })
  } catch (err) {
    return res.status(409).json({ message: (err as Error).message, type: "conflict" })
  }
}
