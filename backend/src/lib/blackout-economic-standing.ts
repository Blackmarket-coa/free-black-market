import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"

/**
 * Resolve the Hawala ledger standing for an MXID and reshape it into the §4
 * `EconomicStanding` minor-units contract. Shared by the economic-standing and
 * summary routes so the conversion lives in one place.
 */
export async function fetchEconomicStanding(req: MedusaRequest, mxid: string) {
  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const entitlement = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
    raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>
  }

  const standing = await hawala.getEconomicStandingByMxid({ mxid, pgConnection })
  return entitlement.getEconomicStanding(standing)
}
