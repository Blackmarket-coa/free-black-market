import EntitlementModuleService from "../service"
import { EntitlementStatus } from "../models"

/**
 * F4 grace: a subscription's per-cycle grants are rolled forward to
 * grace_ends_at — never backward, perpetual rows untouched, revoked rows left
 * revoked. Real prototype method over stubbed data access.
 */
describe("EntitlementModuleService.extendBySubscriptionId", () => {
  const graceEnds = new Date("2026-11-01T00:00:00.000Z")

  function ctx(rows: Array<Record<string, unknown>>) {
    return {
      listEntitlements: jest.fn(async () => rows),
      updateEntitlements: jest.fn(async (u: unknown[]) => u),
    }
  }

  it("extends only ACTIVE, time-limited rows that would lapse before grace ends", async () => {
    const c = ctx([
      { id: "short", status: EntitlementStatus.ACTIVE, expires_at: new Date("2026-10-10T00:00:00.000Z") },
      { id: "longer", status: EntitlementStatus.ACTIVE, expires_at: new Date("2026-12-01T00:00:00.000Z") },
      { id: "perpetual", status: EntitlementStatus.ACTIVE, expires_at: null },
      { id: "revoked", status: EntitlementStatus.REVOKED, expires_at: new Date("2026-10-10T00:00:00.000Z") },
    ])
    const n = await EntitlementModuleService.prototype.extendBySubscriptionId.call(
      c as unknown as EntitlementModuleService,
      "sub_1",
      graceEnds
    )
    expect(n).toBe(1)
    expect(c.listEntitlements).toHaveBeenCalledWith({ source_subscription_id: "sub_1" })
    expect(c.updateEntitlements).toHaveBeenCalledWith([{ id: "short", expires_at: graceEnds }])
  })

  it("writes nothing when nothing needs extending", async () => {
    const c = ctx([{ id: "perpetual", status: EntitlementStatus.ACTIVE, expires_at: null }])
    const n = await EntitlementModuleService.prototype.extendBySubscriptionId.call(
      c as unknown as EntitlementModuleService,
      "sub_1",
      graceEnds
    )
    expect(n).toBe(0)
    expect(c.updateEntitlements).not.toHaveBeenCalled()
  })
})
