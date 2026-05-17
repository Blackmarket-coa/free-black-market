import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import type TenancyModuleService from "../../../../modules/tenancy/service"

/**
 * Sprint A G3: per-step funnel counts for the launch-first onboarding
 * wizard. Cheap aggregation off OnboardingState rows, no separate event
 * table required.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const service = _req.scope.resolve<TenancyModuleService>(TENANCY_MODULE)
  const counts = await service.wizardFunnel()
  return res.json({ counts })
}
