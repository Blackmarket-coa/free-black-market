import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../../../../middlewares/seller-context-v1"
import { CREATOR_PROGRAM_MODULE } from "../../../../../../../modules/creator-program"
import CreatorProgramService from "../../../../../../../modules/creator-program/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../../../modules/marketplace-webhooks/service"

const ApplySchema = z.object({
  pitch: z.string().max(4000).optional().nullable(),
  proposed_platforms: z.array(z.string().max(64)).max(8).optional().nullable(),
  follower_snapshot: z
    .record(z.string().max(32), z.number().int().nonnegative().max(2_000_000_000))
    .optional()
    .nullable(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const programId = (req.params as { id?: string })?.id
  if (!programId) {
    return res.status(400).json({ message: "Missing program id", type: "invalid_request" })
  }

  const parsed = ApplySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid application payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  let webhooks: MarketplaceWebhooksService | null = null
  try {
    webhooks = req.scope.resolve<MarketplaceWebhooksService>(MARKETPLACE_WEBHOOKS_MODULE)
  } catch {
    webhooks = null
  }

  try {
    const application = await service.applyToProgram({
      programId,
      creatorSellerId: sellerId,
      pitch: parsed.data.pitch ?? null,
      proposedPlatforms: parsed.data.proposed_platforms ?? null,
      followerSnapshot: parsed.data.follower_snapshot ?? null,
    })

    if (webhooks) {
      const programs = await service.listCreatorPrograms({ id: programId })
      const program = programs[0]
      if (program) {
        try {
          await webhooks.dispatch("creator.application.submitted", program.vendor_id, {
            application_id: application.id,
            program_id: programId,
            creator_seller_id: sellerId,
          })
        } catch (err) {
          console.error("[apply] webhook dispatch failed", err)
        }
      }
    }

    return res.status(201).json({ application })
  } catch (err) {
    return res.status(409).json({
      message: (err as Error).message,
      type: "conflict",
    })
  }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const programId = (req.params as { id?: string })?.id
  if (!programId) {
    return res.status(400).json({ message: "Missing program id", type: "invalid_request" })
  }

  const service = req.scope.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
  const apps = await service.listCreatorApplications({
    program_id: programId,
    creator_seller_id: sellerId,
  })
  const app = apps[0]
  if (!app) {
    return res.status(404).json({ message: "Application not found", type: "not_found" })
  }
  try {
    const updated = await service.withdrawApplication(app.id, sellerId)
    return res.status(200).json({ application: updated })
  } catch (err) {
    return res.status(409).json({ message: (err as Error).message, type: "conflict" })
  }
}
