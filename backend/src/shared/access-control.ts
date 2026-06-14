import { createLogger } from "./logger"
const log = createLogger("shared/access-control")
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ENTITLEMENT_MODULE } from "../modules/entitlement"
import type EntitlementModuleService from "../modules/entitlement/service"

/**
 * Internal access-control helper for gating FBM actions against the entitlement
 * service's `evaluateAccess`. This is the same decision engine the Blackout
 * OAuth route (`/v1/integrations/blackout/entitlements/access`) exposes
 * externally — here it is callable directly from FBM-authenticated routes.
 *
 * Identity is the Matrix ID (`mxid`); use `resolveMxidForSeller` /
 * `resolveMxidForCustomer` / `resolveMxidForUser` (or the chat routes' own
 * resolution) to obtain it.
 */

export const ACCESS_RESOURCE_KINDS = [
  "matrix-room",
  "fbm-listing",
  "governance-proposal",
  "fulfillment-node",
  "ledger-tx",
  "platform-admin",
] as const

export const ACCESS_ACTIONS = ["read", "write", "admin"] as const

export type AccessResourceKind = (typeof ACCESS_RESOURCE_KINDS)[number]
export type AccessAction = (typeof ACCESS_ACTIONS)[number]

export interface AccessDecision {
  allowed: boolean
  reasons: Array<{ check: string; outcome: "pass" | "fail" | "skip"; detail?: string }>
  evaluated_at: string
}

type Scope = { resolve: (key: string) => any }

/**
 * Evaluate whether `mxid` may perform `action` on the given resource. Never
 * throws: on any internal error it returns a fail-closed decision
 * (`allowed: false`) so callers can gate safely.
 */
export async function evaluateFbmAccess(
  scope: Scope,
  input: {
    mxid: string
    resourceKind: AccessResourceKind
    resourceId: string
    action: AccessAction
  }
): Promise<AccessDecision> {
  try {
    const service = scope.resolve(ENTITLEMENT_MODULE) as EntitlementModuleService
    return await service.evaluateAccess(input)
  } catch (error: any) {
    log.error("[AccessControl] evaluateFbmAccess failed:", error.message)
    return {
      allowed: false,
      reasons: [
        { check: "internal_error", outcome: "fail", detail: "access evaluation failed" },
      ],
      evaluated_at: new Date().toISOString(),
    }
  }
}

/**
 * Look up a seller's provisioned mxid from `seller_metadata`. Returns null when
 * unset (not yet backfilled).
 */
export async function resolveMxidForSeller(
  scope: Scope,
  sellerId: string
): Promise<string | null> {
  try {
    const pgConnection = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
      raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>
    }
    const result = await pgConnection.raw(
      `SELECT mxid FROM seller_metadata WHERE seller_id = ? AND deleted_at IS NULL LIMIT 1`,
      [sellerId]
    )
    const mxid = result?.rows?.[0]?.mxid
    return typeof mxid === "string" && mxid ? mxid : null
  } catch {
    return null
  }
}

/**
 * Look up a customer's mxid from `customer.metadata->>'mxid'`. Returns null when
 * unset.
 */
export async function resolveMxidForCustomer(
  scope: Scope,
  customerId: string
): Promise<string | null> {
  try {
    const pgConnection = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as {
      raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>
    }
    const result = await pgConnection.raw(
      `SELECT metadata->>'mxid' AS mxid FROM customer WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [customerId]
    )
    const mxid = result?.rows?.[0]?.mxid
    return typeof mxid === "string" && mxid ? mxid : null
  } catch {
    return null
  }
}
