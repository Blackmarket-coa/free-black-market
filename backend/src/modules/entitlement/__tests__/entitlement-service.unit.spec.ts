import EntitlementModuleService, { parseResourceUrn } from "../service"
import {
  EntitlementKind,
  EntitlementSource,
  EntitlementStatus,
} from "../models"

/**
 * Unit-tests EntitlementModuleService against an in-memory CRUD fake. We
 * spin up the real class via `Object.create` so the public methods
 * (`grant`, `verify`, `revoke`, ...) reach via the prototype, and patch
 * the auto-generated CRUD ops onto the instance directly.
 */
function makeService(): EntitlementModuleService {
  const rows: any[] = []
  const rules: any[] = []

  const svc = Object.create(
    EntitlementModuleService.prototype
  ) as EntitlementModuleService

  ;(svc as any).listEntitlements = async (filters: Record<string, any> = {}) =>
    rows.filter((e) =>
      Object.entries(filters).every(([k, v]) => v === undefined || e[k] === v)
    )
  ;(svc as any).createEntitlements = async (entries: any[]) => {
    const out = entries.map((e, i) => ({ id: `ent_${rows.length + i + 1}`, ...e }))
    rows.push(...out)
    return out
  }
  ;(svc as any).updateEntitlements = async (updates: any[]) =>
    updates.map((u) => {
      const r = rows.find((x) => x.id === u.id)
      if (r) Object.assign(r, u)
      return r
    })
  ;(svc as any).listEntitlementGrantRules = async (filters: Record<string, any> = {}) =>
    rules.filter((e) =>
      Object.entries(filters).every(([k, v]) => v === undefined || e[k] === v)
    )
  ;(svc as any).createEntitlementGrantRules = async (entries: any[]) => {
    const out = entries.map((e, i) => ({ id: `egr_${rules.length + i + 1}`, ...e }))
    rules.push(...out)
    return out
  }

  return svc
}

describe("EntitlementModuleService", () => {
  it("grant() creates a row with sensible defaults", async () => {
    const svc = makeService()
    const ent = await svc.grant({
      customer_id: "cus_1",
      product_id: "prod_1",
      feature_key: "blackout.creator_tools",
      source_order_id: "order_1",
    })
    expect(ent.feature_key).toBe("blackout.creator_tools")
    expect(ent.kind).toBe(EntitlementKind.OTHER)
    expect(ent.source).toBe(EntitlementSource.ORDER)
    expect(ent.status).toBe(EntitlementStatus.ACTIVE)
  })

  it("grant() is idempotent on (source_order_id, product_id)", async () => {
    const svc = makeService()
    const a = await svc.grant({
      product_id: "prod_1",
      feature_key: "f",
      source_order_id: "order_1",
    })
    const b = await svc.grant({
      product_id: "prod_1",
      feature_key: "f",
      source_order_id: "order_1",
    })
    expect(a.id).toBe(b.id)
  })

  it("verify() requires an active, non-expired entitlement", async () => {
    const svc = makeService()
    await svc.grant({
      customer_id: "cus_1",
      feature_key: "f",
      expires_at: new Date(Date.now() - 1000),
    })
    const expired = await svc.verify({ customer_id: "cus_1", feature_key: "f" })
    expect(expired.entitled).toBe(false)

    await svc.grant({
      customer_id: "cus_1",
      feature_key: "f",
      expires_at: new Date(Date.now() + 60_000),
      source_order_id: "order_alive",
      product_id: "prod_alive",
    })
    const live = await svc.verify({ customer_id: "cus_1", feature_key: "f" })
    expect(live.entitled).toBe(true)
  })

  it("revoke() flips status and stamps revoked_at + reason", async () => {
    const svc = makeService()
    const ent = await svc.grant({
      customer_id: "cus_1",
      feature_key: "f",
      source_order_id: "order_2",
    })
    const out = await svc.revoke(ent.id, "manual")
    expect(out.status).toBe(EntitlementStatus.REVOKED)
    expect(out.revoked_reason).toBe("manual")
    expect(out.revoked_at).toBeTruthy()
  })

  it("revokeByOrderId() revokes every grant from that order", async () => {
    const svc = makeService()
    await svc.grant({ feature_key: "a", product_id: "p1", source_order_id: "ord_x" })
    await svc.grant({ feature_key: "b", product_id: "p2", source_order_id: "ord_x" })
    const n = await svc.revokeByOrderId("ord_x", "refund")
    expect(n).toBe(2)
    const list = await (svc as any).listEntitlements({ source_order_id: "ord_x" })
    for (const e of list) expect(e.status).toBe(EntitlementStatus.REVOKED)
  })

  describe("§2.5 entitlements contract", () => {
    const MXID = "@alice:bmc.example"

    it("listGrantsByMxid() returns grants keyed on customer_external_id", async () => {
      const svc = makeService()
      await svc.grant({
        customer_external_id: MXID,
        feature_key: "listing.write",
        source_order_id: "ord_a",
        product_id: "prod_a",
      })
      await svc.grant({
        customer_external_id: "@bob:bmc.example",
        feature_key: "listing.write",
        source_order_id: "ord_b",
        product_id: "prod_b",
      })
      const grants = await svc.listGrantsByMxid(MXID)
      expect(grants).toHaveLength(1)
      expect(grants[0].feature_key).toBe("listing.write")
    })

    it("listGrantsByMxid() filters by status and feature_key", async () => {
      const svc = makeService()
      await svc.grant({
        customer_external_id: MXID,
        feature_key: "listing.write",
        source_order_id: "ord_1",
        product_id: "p1",
      })
      const ent2 = await svc.grant({
        customer_external_id: MXID,
        feature_key: "listing.admin",
        source_order_id: "ord_2",
        product_id: "p2",
      })
      await svc.revoke(ent2.id, "test")

      const active = await svc.listGrantsByMxid(MXID, { status: EntitlementStatus.ACTIVE })
      expect(active.map((g) => g.feature_key)).toEqual(["listing.write"])

      const writeOnly = await svc.listGrantsByMxid(MXID, { featureKey: "listing.write" })
      expect(writeOnly).toHaveLength(1)
    })

    it("evaluateAccess() returns 400-shape decision when mxid is missing", async () => {
      const svc = makeService()
      const decision = await svc.evaluateAccess({
        mxid: "",
        resourceKind: "fbm-listing",
        resourceId: "prod_1",
        action: "read",
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reasons[0].check).toBe("mxid")
      expect(decision.reasons[0].outcome).toBe("fail")
    })

    it("evaluateAccess() permits public read on fbm-listing without grants", async () => {
      const svc = makeService()
      const decision = await svc.evaluateAccess({
        mxid: MXID,
        resourceKind: "fbm-listing",
        resourceId: "prod_1",
        action: "read",
      })
      expect(decision.allowed).toBe(true)
      expect(decision.reasons.find((r) => r.check === "fbm-listing.read")?.outcome).toBe("pass")
    })

    it("evaluateAccess() denies fbm-listing.write without a matching grant", async () => {
      const svc = makeService()
      const decision = await svc.evaluateAccess({
        mxid: MXID,
        resourceKind: "fbm-listing",
        resourceId: "prod_1",
        action: "write",
      })
      expect(decision.allowed).toBe(false)
      const writeReason = decision.reasons.find((r) => r.check === "fbm-listing.write")
      expect(writeReason?.outcome).toBe("fail")
    })

    it("evaluateAccess() permits fbm-listing.write with a generic listing.write grant", async () => {
      const svc = makeService()
      await svc.grant({
        customer_external_id: MXID,
        feature_key: "listing.write",
        source_order_id: "ord_w",
        product_id: "prod_w",
      })
      const decision = await svc.evaluateAccess({
        mxid: MXID,
        resourceKind: "fbm-listing",
        resourceId: "prod_1",
        action: "write",
      })
      expect(decision.allowed).toBe(true)
    })

    it("evaluateAccess() permits fbm-listing.write with a per-listing grant", async () => {
      const svc = makeService()
      await svc.grant({
        customer_external_id: MXID,
        feature_key: "listing.write.prod_1",
        source_order_id: "ord_specific",
        product_id: "prod_1",
      })
      const decision = await svc.evaluateAccess({
        mxid: MXID,
        resourceKind: "fbm-listing",
        resourceId: "prod_1",
        action: "write",
      })
      expect(decision.allowed).toBe(true)
      expect(decision.reasons.some((r) => r.detail?.includes("listing.write.prod_1"))).toBe(true)
    })

    it("evaluateAccess() returns foundation_milestone_pending for resource kinds whose substrate is still pending", async () => {
      const svc = makeService()
      for (const kind of [
        "matrix-room",
        "fulfillment-node",
        "ledger-tx",
      ] as const) {
        const decision = await svc.evaluateAccess({
          mxid: MXID,
          resourceKind: kind,
          resourceId: "x",
          action: "read",
        })
        expect(decision.allowed).toBe(false)
        const skip = decision.reasons.find((r) => r.check === kind)
        expect(skip?.outcome).toBe("skip")
        expect(skip?.detail).toBe("foundation_milestone_pending")
      }
    })

    it("evaluateAccess() denies governance-proposal.vote without a derived governance permission", async () => {
      const svc = makeService()
      const decision = await svc.evaluateAccess({
        mxid: MXID,
        resourceKind: "governance-proposal",
        resourceId: "prop_1",
        action: "write",
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reasons.some((r) => r.check === "governance-proposal.write")).toBe(true)
    })

    it("evaluateAccess() permits governance-proposal.vote derived from a member role grant", async () => {
      const svc = makeService()
      await svc.grant({
        customer_external_id: MXID,
        feature_key: "governance.role.member.coalition_alpha",
        source_order_id: "ord_role",
        product_id: "role_member",
      })
      const decision = await svc.evaluateAccess({
        mxid: MXID,
        resourceKind: "governance-proposal",
        resourceId: "prop_1",
        action: "write",
      })
      expect(decision.allowed).toBe(true)
    })

    it("evaluateAccess() permits platform-admin only with a platform.admin grant", async () => {
      const svc = makeService()
      const denied = await svc.evaluateAccess({
        mxid: MXID,
        resourceKind: "platform-admin",
        resourceId: "any",
        action: "admin",
      })
      expect(denied.allowed).toBe(false)

      await svc.grant({
        customer_external_id: MXID,
        feature_key: "platform.admin",
        source_order_id: "ord_admin",
        product_id: "p_admin",
      })
      const allowed = await svc.evaluateAccess({
        mxid: MXID,
        resourceKind: "platform-admin",
        resourceId: "any",
        action: "admin",
      })
      expect(allowed.allowed).toBe(true)
    })

    it("getGovernanceRoles() reads governance.role.<role>.<coalition> grants and derives FBM permissions", async () => {
      const svc = makeService()
      await svc.grant({
        customer_external_id: MXID,
        feature_key: "governance.role.steward.coalition_alpha",
        source_order_id: "ord_a",
        product_id: "p_a",
      })
      await svc.grant({
        customer_external_id: MXID,
        feature_key: "governance.role.member.coalition_beta",
        source_order_id: "ord_b",
        product_id: "p_b",
      })

      const snapshot = await svc.getGovernanceRoles(MXID)
      expect(snapshot.roles).toHaveLength(2)

      const steward = snapshot.roles.find((r) => r.role === "steward")
      expect(steward?.coalitionId).toBe("coalition_alpha")
      expect(steward?.commercePermissions).toEqual(
        expect.arrayContaining(["listing.create", "governance.proposal.create"])
      )
      expect(steward?.matrixAcls.find((a) => a.roomId === "!coalition_alpha-governance")?.powerLevel).toBe(50)

      const member = snapshot.roles.find((r) => r.role === "member")
      expect(member?.coalitionId).toBe("coalition_beta")
      expect(member?.commercePermissions).toEqual(expect.arrayContaining(["governance.proposal.vote"]))
    })

    it("getGovernanceRoles() returns an empty role list when the MXID holds no role grants", async () => {
      const svc = makeService()
      const snapshot = await svc.getGovernanceRoles(MXID)
      expect(snapshot.roles).toEqual([])
    })
  })

  describe("§4 normative contract", () => {
    const MXID = "@alice:theblackout.app"

    it("parseResourceUrn maps urn:fbm:* onto internal kinds", () => {
      expect(parseResourceUrn("urn:fbm:room:!abc")).toEqual({ kind: "matrix-room", id: "!abc" })
      expect(parseResourceUrn("urn:fbm:listing:lst_1")).toEqual({ kind: "fbm-listing", id: "lst_1" })
      expect(parseResourceUrn("urn:fbm:proposal:p1")).toEqual({ kind: "governance-proposal", id: "p1" })
      expect(parseResourceUrn("urn:fbm:fulfillment-node:n1")).toEqual({ kind: "fulfillment-node", id: "n1" })
      expect(parseResourceUrn("urn:fbm:ledger-tx:tx1")).toEqual({ kind: "ledger-tx", id: "tx1" })
      expect(parseResourceUrn("urn:fbm:platform:admin")).toEqual({ kind: "platform-admin", id: "admin" })
      expect(parseResourceUrn("not-a-urn")).toBeNull()
      expect(parseResourceUrn("urn:fbm:room:")).toBeNull()
    })

    it("checkAccess returns { allowed, source } and treats administer as admin", async () => {
      const svc = makeService()
      // public read on a listing
      const pub = await svc.checkAccess({ mxid: MXID, urn: "urn:fbm:listing:lst_1", action: "read" })
      expect(pub).toEqual({ allowed: true, source: "public" })

      // platform admin granted -> administer allowed via grant
      await svc.grant({
        customer_external_id: MXID,
        feature_key: "platform.admin",
        source_order_id: "o1",
        product_id: "p1",
      })
      const admin = await svc.checkAccess({ mxid: MXID, urn: "urn:fbm:platform:admin", action: "administer" })
      expect(admin.allowed).toBe(true)
      expect(admin.source).toBe("grant")

      // invalid urn
      const bad = await svc.checkAccess({ mxid: MXID, urn: "nope", action: "read" })
      expect(bad).toEqual({ allowed: false, source: "invalid_urn" })
    })

    it("checkAccessBatch preserves input order", async () => {
      const svc = makeService()
      const results = await svc.checkAccessBatch(MXID, [
        { urn: "urn:fbm:listing:a", action: "read" }, // public -> allowed
        { urn: "urn:fbm:platform:admin", action: "administer" }, // denied (no grant)
      ])
      expect(results).toHaveLength(2)
      expect(results[0].allowed).toBe(true)
      expect(results[1].allowed).toBe(false)
    })

    it("getEconomicStanding converts ledger dollars to minor units", async () => {
      const svc = makeService()
      const standing = await svc.getEconomicStanding({
        available: 12.34,
        pending: 1.0,
        currency: "USD",
        last_settlement_at: null,
        sources: [{ account_type: "SELLER_EARNINGS", available: 10, pending: 2 }],
      })
      expect(standing.coalitionCreditsBalanceMinorUnits).toBe(1334) // (12.34 + 1.00) * 100
      expect(standing.currency).toBe("USD")
      expect(standing.pendingPayouts).toEqual([{ amountMinorUnits: 200, currency: "USD" }])
      expect(standing.vendorSalesVolumeMinorUnits30d).toBe(1200) // (10 + 2) * 100
    })

    it("getEconomicStanding reports null vendor volume when not a vendor", async () => {
      const svc = makeService()
      const standing = await svc.getEconomicStanding({
        available: 0,
        pending: 0,
        currency: "USD",
        last_settlement_at: null,
        sources: [],
      })
      expect(standing.vendorSalesVolumeMinorUnits30d).toBeNull()
      expect(standing.pendingPayouts).toEqual([])
    })

    it("getCoalitionMemberships returns a stable empty list", async () => {
      const svc = makeService()
      expect(await svc.getCoalitionMemberships(MXID)).toEqual({ memberships: [] })
    })
  })
})
