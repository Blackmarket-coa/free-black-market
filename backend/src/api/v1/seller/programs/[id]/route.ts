import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../modules/creator-program/service"
import { CreatorProgramStatus } from "../../../../../modules/creator-program/models"

const PatchSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  brief_markdown: z.string().max(20000).optional().nullable(),
  status: z.nativeEnum(CreatorProgramStatus).optional(),
  ends_at: z.string().datetime().optional().nullable(),
  budget_cap_cents: z.number().int().min(0).max(1_000_000_000_000).optional().nullable(),
  min_followers: z.number().int().min(0).max(2_000_000_000).optional().nullable(),
  requires_kyc: z.boolean().optional(),
  min_verification_level: z.string().max(64).optional().nullable(),
})

async function ownProgram(
  req: MedusaRequest,
  service: CreatorProgramService
): Promise<{ program: any | null; sellerId: string | null; programId: string | null }> {
  const sellerId = (req as SellerAuthRequest).seller_id ?? null
  const programId = (req.params as { id?: string })?.id ?? null
  if (!sellerId || !programId) return { program: null, sellerId, programId }
  const list = await service.listCreatorPrograms({ id: programId, vendor_id: sellerId })
  return { program: list[0] ?? null, sellerId, programId }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const { program, sellerId } = await ownProgram(req, service)
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  if (!program) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }
  return res.status(200).json({ program })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const { program, sellerId, programId } = await ownProgram(req, service)
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  if (!program || !programId) {
    return res.status(404).json({ message: "Program not found", type: "not_found" })
  }
  const parsed = PatchSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid update payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const updates: Record<string, unknown> = { id: programId }
  if (parsed.data.title !== undefined) updates.title = parsed.data.title
  if (parsed.data.description !== undefined) updates.description = parsed.data.description
  if (parsed.data.brief_markdown !== undefined) updates.brief_markdown = parsed.data.brief_markdown
  if (parsed.data.status !== undefined) updates.status = parsed.data.status
  if (parsed.data.ends_at !== undefined)
    updates.ends_at = parsed.data.ends_at ? new Date(parsed.data.ends_at) : null
  if (parsed.data.budget_cap_cents !== undefined) updates.budget_cap_cents = parsed.data.budget_cap_cents
  if (parsed.data.min_followers !== undefined) updates.min_followers = parsed.data.min_followers
  if (parsed.data.requires_kyc !== undefined) updates.requires_kyc = parsed.data.requires_kyc
  if (parsed.data.min_verification_level !== undefined)
    updates.min_verification_level = parsed.data.min_verification_level

  const updated = await (service as any).updateCreatorPrograms(updates)
  return res.status(200).json({ program: updated })
}
