import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"
import { PROGRESSION_MODULE } from "../modules/progression"
import type ProgressionModuleService from "../modules/progression/service"
import { resolveCustomerIdByMxid } from "./blackout-identity"

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
  const shaped = entitlement.getEconomicStanding(standing)

  return { ...shaped, coalitionKarmaTier: await coalitionKarmaTier(req, mxid) }
}

/**
 * This member's rung on the coalition ladder, or `null` when we cannot say.
 *
 * `null` is a real answer, not a fallback, and the distinction is the point.
 * Blackout's coalition join gate is the only consumer: it sends someone to a
 * steward when the answer is `null` and admits or queues them on the merits
 * when it is a tier. Collapsing "no FBM identity" and "nothing earned yet"
 * into `seedling` is what made every gate above the floor silently queue 100%
 * of joiners — the gate could not tell a member with no standing from a lookup
 * that never worked.
 *
 * Best-effort by construction: a progression outage must degrade the gate to
 * "ask a human", never fail the whole standing response, which also carries
 * balances a payout screen needs.
 */
async function coalitionKarmaTier(
  req: MedusaRequest,
  mxid: string
): Promise<string | null> {
  try {
    const customerId = await resolveCustomerIdByMxid(req.scope, mxid)
    if (!customerId) return null
    const progression = req.scope.resolve<ProgressionModuleService>(PROGRESSION_MODULE)
    const { tier } = await progression.getCoalitionKarmaTier(customerId)
    return tier
  } catch {
    return null
  }
}
