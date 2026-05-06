import EntitlementModuleService from "../service"
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
})
