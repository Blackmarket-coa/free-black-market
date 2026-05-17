import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TENANCY_MODULE } from "../../../modules/tenancy"
import {
  OnboardingSellingType,
  OnboardingWizardStep,
} from "../../../modules/tenancy/models"
import type TenancyModuleService from "../../../modules/tenancy/service"

async function resolveSellerId(req: MedusaRequest, actorId?: string): Promise<string | undefined> {
  if (!actorId) return undefined
  if (!actorId.startsWith("mem_")) return actorId
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const memberResult = await pgConnection.raw(
      `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
      [actorId]
    )
    return memberResult.rows?.[0]?.seller_id || actorId
  } catch {
    return actorId
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const state = await service.ensureSellerOnboardingState(sellerId)
  return res.json({ state })
}

type PatchBody = {
  step?: OnboardingWizardStep
  selling_type?: OnboardingSellingType | null
  payout_deferred_until_first_sale?: boolean
}

export async function PATCH(req: MedusaRequest<PatchBody>, res: MedusaResponse) {
  const actorId = (req as any)._seller_id || (req as any).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.validatedBody || req.body || {}) as PatchBody
  if (
    body.step &&
    !Object.values(OnboardingWizardStep).includes(body.step)
  ) {
    return res.status(400).json({ message: `Invalid step: ${body.step}` })
  }
  if (
    body.selling_type !== undefined &&
    body.selling_type !== null &&
    !Object.values(OnboardingSellingType).includes(body.selling_type)
  ) {
    return res.status(400).json({ message: `Invalid selling_type: ${body.selling_type}` })
  }

  const service = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  if (!body.step) {
    // Allow PATCHing only the friction-flag without advancing.
    const state = await service.ensureSellerOnboardingState(sellerId)
    if (body.payout_deferred_until_first_sale !== undefined) {
      const [updated] = await service.updateOnboardingStates([
        {
          id: state.id,
          payout_deferred_until_first_sale: body.payout_deferred_until_first_sale,
        } as any,
      ])
      return res.json({ state: updated })
    }
    return res.json({ state })
  }

  const state = await service.advanceWizardStep({
    seller_id: sellerId,
    step: body.step,
    selling_type: body.selling_type,
    payout_deferred_until_first_sale: body.payout_deferred_until_first_sale,
  })
  return res.json({ state })
}
