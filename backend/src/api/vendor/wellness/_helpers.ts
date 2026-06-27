import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../shared"
import { WELLNESS_MODULE } from "../../../modules/wellness"
import type WellnessModuleService from "../../../modules/wellness/service"

/** Resolve the wellness module service from the request scope. */
export function wellnessService(
  req: AuthenticatedMedusaRequest
): WellnessModuleService {
  return req.scope.resolve(WELLNESS_MODULE) as WellnessModuleService
}

/** Require the authenticated seller id (sends 401 + returns null on failure). */
export async function sellerId(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<string | null> {
  return requireSellerId(req, res)
}

/** Standard 500 response with a logged message. */
export function fail(
  res: MedusaResponse,
  log: { error: (...a: unknown[]) => void },
  scope: string,
  error: unknown
) {
  const msg = error instanceof Error ? error.message : "Unknown error"
  log.error(`[${scope}] failed:`, msg)
  return res.status(500).json({ message: `Failed: ${scope}`, type: "server_error" })
}

export function body<T = Record<string, unknown>>(req: AuthenticatedMedusaRequest): T {
  return (req.body ?? {}) as T
}
