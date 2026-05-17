import { MedusaService } from "@medusajs/framework/utils"
import { InferTypeOf } from "@medusajs/framework/types"
import {
  Entitlement,
  EntitlementGrantRule,
  EntitlementKind,
  EntitlementSource,
  EntitlementStatus,
} from "./models"

export type EntitlementType = InferTypeOf<typeof Entitlement>
export type EntitlementGrantRuleType = InferTypeOf<typeof EntitlementGrantRule>

/**
 * Static governance-role → FBM commerce-permission mapping per
 * AGGRESSIVE_OPERATIONS_GUIDE.md §2.1. Roles are Matrix-side names; the
 * permission keys here are the FBM-side feature keys the entitlements
 * service answers `evaluateAccess` against. Keep flat and explicit; if
 * this grows past one screen, replace with a Casbin policy file.
 */
const GOVERNANCE_FBM_PERMISSIONS: Record<string, string[]> = {
  vendor: ["listing.create", "listing.write", "order.fulfill", "payout.withdraw"],
  steward: [
    "listing.create",
    "listing.write",
    "order.fulfill",
    "payout.withdraw",
    "governance.proposal.create",
    "coalition.member.invite",
  ],
  member: ["listing.read", "governance.proposal.vote"],
  observer: ["listing.read"],
}

const GOVERNANCE_VOTE_ELIGIBILITY: Record<string, string[]> = {
  vendor: ["finance", "operations"],
  steward: ["finance", "operations", "membership", "constitution"],
  member: ["finance", "operations", "membership"],
  observer: [],
}

/**
 * Synapse power level a role implies inside the coalition's governance
 * room. Default is 0 (member). 50 is moderator-equivalent and 100 is
 * room-admin-equivalent in the standard Matrix power-level model.
 */
const GOVERNANCE_POWER_LEVEL: Record<string, number> = {
  vendor: 25,
  steward: 50,
  member: 0,
  observer: 0,
}

function matrixAclsForRole(
  role: string,
  coalitionId: string
): Array<{ room_id: string; level: number }> {
  const level = GOVERNANCE_POWER_LEVEL[role] ?? 0
  // Convention: every coalition has a `governance` room and a `commerce`
  // room. The Blackout side owns the actual room IDs; we just expose
  // intent here as `!<coalition>:<room>` style refs that Blackout can
  // resolve against its room directory.
  return [
    { room_id: `!${coalitionId}-governance`, level },
    { room_id: `!${coalitionId}-commerce`, level },
  ]
}

function derivedPermissionsFromGrants(
  grants: Array<{ feature_key: string }>
): Set<string> {
  const out = new Set<string>()
  for (const g of grants) {
    out.add(g.feature_key)
    const parts = g.feature_key.split(".")
    if (parts[0] === "governance" && parts[1] === "role" && parts.length >= 4) {
      const role = parts[2]
      for (const perm of GOVERNANCE_FBM_PERMISSIONS[role] ?? []) {
        out.add(perm)
      }
    }
  }
  return out
}

export type GrantInput = {
  customer_id?: string | null
  customer_external_id?: string | null
  product_id?: string | null
  variant_id?: string | null
  feature_key: string
  kind?: EntitlementKind
  source?: EntitlementSource
  source_order_id?: string | null
  source_subscription_id?: string | null
  expires_at?: Date | null
  metadata?: Record<string, unknown> | null
}

export type VerifyInput = {
  customer_id?: string
  customer_external_id?: string
  feature_key: string
}

class EntitlementModuleService extends MedusaService({
  Entitlement,
  EntitlementGrantRule,
}) {
  /**
   * Idempotently grant an entitlement. If an entitlement already exists
   * for the (source_order_id, product_id) tuple, the existing row is
   * returned untouched.
   */
  async grant(input: GrantInput): Promise<EntitlementType> {
    if (!input.feature_key) {
      throw new Error("feature_key is required")
    }

    if (input.source_order_id && input.product_id) {
      const [existing] = await this.listEntitlements({
        source_order_id: input.source_order_id,
        product_id: input.product_id,
      })
      if (existing) return existing
    }

    const [created] = await this.createEntitlements([
      {
        customer_id: input.customer_id ?? null,
        customer_external_id: input.customer_external_id ?? null,
        product_id: input.product_id ?? null,
        variant_id: input.variant_id ?? null,
        feature_key: input.feature_key,
        kind: input.kind ?? EntitlementKind.OTHER,
        source: input.source ?? EntitlementSource.ORDER,
        source_order_id: input.source_order_id ?? null,
        source_subscription_id: input.source_subscription_id ?? null,
        granted_at: new Date(),
        expires_at: input.expires_at ?? null,
        status: EntitlementStatus.ACTIVE,
        metadata: input.metadata ?? null,
      },
    ])
    return created
  }

  /**
   * Iterate every grant rule that matches a line item's product or variant
   * and grant an entitlement for each. Idempotent.
   */
  async grantFromOrder(args: {
    order_id: string
    customer_id?: string | null
    customer_external_id?: string | null
    items: Array<{ product_id?: string | null; variant_id?: string | null }>
    source_subscription_id?: string | null
  }): Promise<EntitlementType[]> {
    const granted: EntitlementType[] = []
    const source = args.source_subscription_id
      ? EntitlementSource.SUBSCRIPTION
      : EntitlementSource.ORDER
    for (const item of args.items) {
      const rules = await this.findApplicableRules({
        product_id: item.product_id ?? undefined,
        variant_id: item.variant_id ?? undefined,
      })
      for (const rule of rules) {
        const expires_at = rule.duration_days
          ? new Date(Date.now() + rule.duration_days * 24 * 60 * 60 * 1000)
          : null
        const ent = await this.grant({
          customer_id: args.customer_id,
          customer_external_id: args.customer_external_id,
          product_id: item.product_id ?? null,
          variant_id: item.variant_id ?? null,
          feature_key: rule.feature_key,
          kind: rule.kind as EntitlementKind,
          source,
          source_order_id: args.order_id,
          source_subscription_id: args.source_subscription_id ?? null,
          expires_at,
        })
        granted.push(ent)
      }
    }
    return granted
  }

  async grantFromSubscription(args: {
    subscription_id: string
    customer_id?: string | null
    customer_external_id?: string | null
    feature_key: string
    kind?: EntitlementKind
    expires_at?: Date | null
  }): Promise<EntitlementType> {
    return this.grant({
      customer_id: args.customer_id,
      customer_external_id: args.customer_external_id,
      feature_key: args.feature_key,
      kind: args.kind,
      source: EntitlementSource.SUBSCRIPTION,
      source_subscription_id: args.subscription_id,
      expires_at: args.expires_at ?? null,
    })
  }

  async revoke(id: string, reason?: string): Promise<EntitlementType> {
    const [updated] = await this.updateEntitlements([
      {
        id,
        status: EntitlementStatus.REVOKED,
        revoked_at: new Date(),
        revoked_reason: reason ?? null,
      },
    ])
    return updated
  }

  async revokeByOrderId(orderId: string, reason?: string): Promise<number> {
    const ents = await this.listEntitlements({ source_order_id: orderId })
    if (!ents.length) return 0
    await this.updateEntitlements(
      ents.map((e: EntitlementType) => ({
        id: e.id,
        status: EntitlementStatus.REVOKED,
        revoked_at: new Date(),
        revoked_reason: reason ?? null,
      }))
    )
    return ents.length
  }

  /**
   * Returns whether the customer (looked up by Medusa customer_id or by
   * Blackout-side external id) currently holds an active, non-expired
   * entitlement for the requested feature_key.
   */
  async verify(input: VerifyInput): Promise<{ entitled: boolean; entitlements: EntitlementType[] }> {
    if (!input.feature_key) {
      return { entitled: false, entitlements: [] }
    }
    if (!input.customer_id && !input.customer_external_id) {
      return { entitled: false, entitlements: [] }
    }

    const filters: Record<string, unknown> = {
      feature_key: input.feature_key,
      status: EntitlementStatus.ACTIVE,
    }
    if (input.customer_id) filters.customer_id = input.customer_id
    if (input.customer_external_id) filters.customer_external_id = input.customer_external_id

    const matches = await this.listEntitlements(filters)
    const now = Date.now()
    const live = matches.filter(
      (e: EntitlementType) => !e.expires_at || new Date(e.expires_at).getTime() > now
    )
    return { entitled: live.length > 0, entitlements: live }
  }

  async listForCustomer(
    customerId: string,
    options: { activeOnly?: boolean } = {}
  ): Promise<EntitlementType[]> {
    const filters: Record<string, unknown> = { customer_id: customerId }
    if (options.activeOnly) {
      filters.status = EntitlementStatus.ACTIVE
    }
    const items = await this.listEntitlements(filters)
    if (!options.activeOnly) return items
    const now = Date.now()
    return items.filter(
      (e: EntitlementType) => !e.expires_at || new Date(e.expires_at).getTime() > now
    )
  }

  /**
   * List grants for a Matrix MXID (stored as `customer_external_id`).
   * Implements the `/entitlements/grants` operation in
   * `docs/contracts/entitlements.yaml`.
   */
  async listGrantsByMxid(
    mxid: string,
    options: { status?: EntitlementStatus; featureKey?: string } = {}
  ): Promise<EntitlementType[]> {
    const filters: Record<string, unknown> = { customer_external_id: mxid }
    if (options.status) filters.status = options.status
    if (options.featureKey) filters.feature_key = options.featureKey
    const items = await this.listEntitlements(filters)
    return items
  }

  /**
   * Render an access decision for a (mxid, resource, action) triple per
   * the §2.5 entitlements service contract. Resource kinds the substrate
   * has policy for today are evaluated against the entitlement table;
   * kinds whose policy depends on foundation-milestone modules
   * (governance, coalitions, ledger) are returned as `allowed=false`
   * with reason `foundation_milestone_pending` so callers can detect the
   * pending state without conflating it with a real denial.
   */
  async evaluateAccess(input: {
    mxid: string
    resourceKind:
      | "matrix-room"
      | "fbm-listing"
      | "governance-proposal"
      | "fulfillment-node"
      | "ledger-tx"
      | "platform-admin"
    resourceId: string
    action: "read" | "write" | "admin"
  }): Promise<{
    allowed: boolean
    reasons: Array<{
      check: string
      outcome: "pass" | "fail" | "skip"
      detail?: string
    }>
    evaluated_at: string
  }> {
    const reasons: Array<{
      check: string
      outcome: "pass" | "fail" | "skip"
      detail?: string
    }> = []
    const evaluated_at = new Date().toISOString()

    if (!input.mxid) {
      return {
        allowed: false,
        reasons: [{ check: "mxid", outcome: "fail", detail: "mxid is required" }],
        evaluated_at,
      }
    }

    const grants = await this.listGrantsByMxid(input.mxid, {
      status: EntitlementStatus.ACTIVE,
    })
    const now = Date.now()
    const live = grants.filter(
      (e) => !e.expires_at || new Date(e.expires_at).getTime() > now
    )
    reasons.push({
      check: "active_grants",
      outcome: "pass",
      detail: `${live.length} active grant(s) for ${input.mxid}`,
    })

    switch (input.resourceKind) {
      case "fbm-listing": {
        if (input.action === "read") {
          reasons.push({
            check: "fbm-listing.read",
            outcome: "pass",
            detail: "public-by-default",
          })
          return { allowed: true, reasons, evaluated_at }
        }
        const writeKeys = new Set([
          `listing.${input.action}`,
          `listing.${input.action}.${input.resourceId}`,
        ])
        const match = live.find((e) => writeKeys.has(e.feature_key))
        if (match) {
          reasons.push({
            check: `fbm-listing.${input.action}`,
            outcome: "pass",
            detail: `granted by feature_key=${match.feature_key}`,
          })
          return { allowed: true, reasons, evaluated_at }
        }
        reasons.push({
          check: `fbm-listing.${input.action}`,
          outcome: "fail",
          detail: `no active grant matched feature_key in {${[...writeKeys].join(", ")}}`,
        })
        return { allowed: false, reasons, evaluated_at }
      }
      case "governance-proposal": {
        const required = `governance.proposal.${input.action === "read" ? "read" : input.action === "write" ? "vote" : "create"}`
        const derived = derivedPermissionsFromGrants(live)
        if (derived.has(required) || derived.has("governance.proposal.create")) {
          reasons.push({
            check: `governance-proposal.${input.action}`,
            outcome: "pass",
            detail: `derived permission ${required}`,
          })
          return { allowed: true, reasons, evaluated_at }
        }
        reasons.push({
          check: `governance-proposal.${input.action}`,
          outcome: "fail",
          detail: `no governance role grants ${required}`,
        })
        return { allowed: false, reasons, evaluated_at }
      }
      case "platform-admin": {
        const adminMatch = live.find((e) => e.feature_key === "platform.admin")
        if (adminMatch) {
          reasons.push({
            check: "platform-admin",
            outcome: "pass",
            detail: `granted by feature_key=${adminMatch.feature_key}`,
          })
          return { allowed: true, reasons, evaluated_at }
        }
        reasons.push({
          check: "platform-admin",
          outcome: "fail",
          detail: "no platform.admin grant",
        })
        return { allowed: false, reasons, evaluated_at }
      }
      case "matrix-room":
      case "fulfillment-node":
      case "ledger-tx":
        reasons.push({
          check: input.resourceKind,
          outcome: "skip",
          detail: "foundation_milestone_pending",
        })
        return { allowed: false, reasons, evaluated_at }
    }
  }

  /**
   * Render a governance-roles snapshot for an MXID per the §2.5 contract.
   *
   * The role→permission mapping is intentionally a static table here.
   * Casbin or similar is reserved for the moment this outgrows a screen —
   * see plan workstream 1 OSS leverage notes. Coalition membership
   * resolution itself remains foundation_milestone_pending until the
   * `cooperative` module exposes membership; this method returns the
   * derived FBM permissions and Synapse power-level intent for any roles
   * the entitlement table already records as feature_keys of the form
   * `governance.role.<role>.<coalition_id>`.
   */
  async getGovernanceRoles(mxid: string): Promise<{
    mxid: string
    roles: Array<{
      coalition_id: string
      role: string
      vote_eligibility: string[]
      matrix_acls: Array<{ room_id: string; level: number }>
      fbm_permissions: string[]
    }>
    evaluated_at: string
  }> {
    const evaluated_at = new Date().toISOString()
    if (!mxid) {
      return { mxid: "", roles: [], evaluated_at }
    }
    const grants = await this.listGrantsByMxid(mxid, {
      status: EntitlementStatus.ACTIVE,
    })
    const now = Date.now()
    const live = grants.filter(
      (e) => !e.expires_at || new Date(e.expires_at).getTime() > now
    )

    const rolesByCoalition = new Map<
      string,
      { role: string; coalition_id: string }
    >()
    for (const g of live) {
      const parts = g.feature_key.split(".")
      if (parts[0] === "governance" && parts[1] === "role" && parts.length >= 4) {
        const role = parts[2]
        const coalition_id = parts.slice(3).join(".")
        const key = `${coalition_id}::${role}`
        if (!rolesByCoalition.has(key)) {
          rolesByCoalition.set(key, { role, coalition_id })
        }
      }
    }

    const roles = Array.from(rolesByCoalition.values()).map(
      ({ role, coalition_id }) => ({
        coalition_id,
        role,
        vote_eligibility: GOVERNANCE_VOTE_ELIGIBILITY[role] ?? [],
        matrix_acls: matrixAclsForRole(role, coalition_id),
        fbm_permissions: GOVERNANCE_FBM_PERMISSIONS[role] ?? [],
      })
    )

    return { mxid, roles, evaluated_at }
  }

  private async findApplicableRules(args: {
    product_id?: string
    variant_id?: string
  }): Promise<EntitlementGrantRuleType[]> {
    const out: EntitlementGrantRuleType[] = []
    if (args.variant_id) {
      const byVariant = await this.listEntitlementGrantRules({
        variant_id: args.variant_id,
        enabled: true,
      })
      out.push(...byVariant)
    }
    if (args.product_id) {
      const byProduct = await this.listEntitlementGrantRules({
        product_id: args.product_id,
        variant_id: null,
        enabled: true,
      })
      out.push(...byProduct)
    }
    return out
  }
}

export default EntitlementModuleService
