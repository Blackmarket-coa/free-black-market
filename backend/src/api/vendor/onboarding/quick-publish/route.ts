import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import {
  OnboardingSellingType,
  OnboardingWizardStep,
} from "../../../../modules/tenancy/models"
import type TenancyModuleService from "../../../../modules/tenancy/service"

/**
 * 60-second creator onboarding "quick path".
 *
 * Collapses signup → step_1 → step_2 into a single POST: pick a selling
 * type and provide the bare-minimum product fields, and we advance the
 * wizard to STEP_3 (delivery) with `quick_path_used = true`. Payout/KYC
 * stay deferred via the existing `payout_deferred_until_first_sale` flag.
 *
 * The actual product creation is handled by the existing vendor product
 * routes — we deliberately don't create the product here so that all the
 * existing draft/listing pipeline (validation, archetypes, fulfillment
 * rules) keeps applying. The endpoint just records the intent on
 * OnboardingState and surfaces a `next_step_url` the UI can navigate to.
 */

async function resolveSellerId(
  req: MedusaRequest,
  actorId?: string
): Promise<string | undefined> {
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

type Body = {
  selling_type?: OnboardingSellingType
  handle?: string
  niches?: string[]
  sample_product?: {
    title?: string
    price_cents?: number
  }
}

export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const body = (req.validatedBody || req.body || {}) as Body

  if (
    !body.selling_type ||
    !Object.values(OnboardingSellingType).includes(body.selling_type)
  ) {
    return res
      .status(400)
      .json({ message: "selling_type is required and must be one of " + Object.values(OnboardingSellingType).join(", ") })
  }

  const tenancy = req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const state = await tenancy.ensureSellerOnboardingState(sellerId)

  const completed = (state.wizard_step_completed_at ?? {}) as Record<string, string>
  const now = new Date().toISOString()
  completed[OnboardingWizardStep.SIGNUP] = completed[OnboardingWizardStep.SIGNUP] ?? now
  completed[OnboardingWizardStep.STEP_1] = now
  completed[OnboardingWizardStep.STEP_2] = now

  const metadata = {
    ...((state.metadata as Record<string, unknown>) ?? {}),
    quick_path: {
      handle: body.handle ?? null,
      niches: body.niches ?? null,
      sample_product: body.sample_product ?? null,
      submitted_at: now,
    },
  }

  const [updated] = await tenancy.updateOnboardingStates([
    {
      id: state.id,
      wizard_step: OnboardingWizardStep.STEP_3,
      wizard_step_completed_at: completed,
      selling_type: body.selling_type,
      quick_path_used: true,
      payout_deferred_until_first_sale: true,
      wizard_started_at: state.wizard_started_at ?? new Date(),
      metadata,
    },
  ])

  return res.status(200).json({
    state: updated,
    next_step_url: "/onboarding?step=step_3",
  })
}
