import { aggregateSubstrates } from "../substrate/aggregate"
import { hasDomainField } from "../engine"
import { permitRecordedAndCurrent } from "../definitions/shared"
import { makeSubstrate } from "./_fixtures"
import type { PermitsSummary, PermitStanding } from "../types"

const standing = (over: Partial<PermitStanding> = {}): PermitStanding => ({
  status: "ok",
  expires_at: "2027-01-01T00:00:00.000Z",
  days_until: 115,
  ...over,
})

const permits = (over: Partial<PermitsSummary> = {}): PermitsSummary => ({
  operation_type: "cottage_food",
  permit: standing(),
  food_handler: standing(),
  advisory_count: 0,
  ...over,
})

describe("permits substrate field", () => {
  describe("domain-optional semantics", () => {
    it("is absent by default, so a requirement needing it is unavailable", () => {
      const s = makeSubstrate()
      expect(s.permits).toBeNull()
      expect(hasDomainField(s, "permits")).toBe(false)
    })

    it("is present once a seller has a compliance profile", () => {
      const s = makeSubstrate({ permits: permits() })
      expect(hasDomainField(s, "permits")).toBe(true)
    })
  })

  describe("permitRecordedAndCurrent", () => {
    it("passes on a recorded, in-date credential", () => {
      const s = makeSubstrate({ permits: permits() })
      expect(permitRecordedAndCurrent("permit")(s)).toBe(true)
      expect(permitRecordedAndCurrent("food_handler")(s)).toBe(true)
    })

    it("still passes while expiring soon — that is a valid permit", () => {
      const s = makeSubstrate({
        permits: permits({ permit: standing({ status: "expiring_soon", days_until: 12 }) }),
      })
      expect(permitRecordedAndCurrent("permit")(s)).toBe(true)
    })

    it("fails once lapsed", () => {
      const s = makeSubstrate({
        permits: permits({ permit: standing({ status: "expired", days_until: -3 }) }),
      })
      expect(permitRecordedAndCurrent("permit")(s)).toBe(false)
    })

    it("fails when nothing was declared, rather than reading as satisfied", () => {
      const s = makeSubstrate({
        permits: permits({
          permit: standing({ status: "unset", expires_at: null, days_until: null }),
        }),
      })
      expect(permitRecordedAndCurrent("permit")(s)).toBe(false)
    })

    it("reads each credential independently", () => {
      const s = makeSubstrate({
        permits: permits({ food_handler: standing({ status: "expired", days_until: -1 }) }),
      })
      expect(permitRecordedAndCurrent("permit")(s)).toBe(true)
      expect(permitRecordedAndCurrent("food_handler")(s)).toBe(false)
    })

    it("is false — not a crash — when the field is absent entirely", () => {
      expect(permitRecordedAndCurrent("permit")(makeSubstrate())).toBe(false)
    })
  })

  describe("aggregation across a collective", () => {
    const agg = (list: (PermitsSummary | null)[]) =>
      aggregateSubstrates(
        list.map((p, i) => makeSubstrate({ seller_id: `sel_${i}`, permits: p })),
        list.map((_, i) => `sel_${i}`)
      ).permits

    it("is null when no member has a profile", () => {
      expect(agg([null, null])).toBeNull()
    })

    it("takes the worst status, not the first or the best", () => {
      const out = agg([
        permits(),
        permits({ permit: standing({ status: "expired", days_until: -2 }) }),
      ])
      expect(out!.permit.status).toBe("expired")
    })

    it("ranks unset as worse than ok but better than a lapse", () => {
      expect(
        agg([permits(), permits({ permit: standing({ status: "unset" }) })])!.permit.status
      ).toBe("unset")
      expect(
        agg([
          permits({ permit: standing({ status: "unset" }) }),
          permits({ permit: standing({ status: "expired", days_until: -1 }) }),
        ])!.permit.status
      ).toBe("expired")
    })

    it("reports the soonest expiry, which need not be the worst member's", () => {
      const out = agg([
        permits({ permit: standing({ status: "expired", days_until: -1, expires_at: "2026-09-07T00:00:00.000Z" }) }),
        permits({ permit: standing({ status: "ok", days_until: -5, expires_at: "2026-09-03T00:00:00.000Z" }) }),
      ])
      // Worst status from the first, soonest date from the second.
      expect(out!.permit.status).toBe("expired")
      expect(out!.permit.days_until).toBe(-5)
      expect(out!.permit.expires_at).toBe("2026-09-03T00:00:00.000Z")
    })

    it("keeps a shared operation_type and drops a mixed one", () => {
      expect(agg([permits(), permits()])!.operation_type).toBe("cottage_food")
      expect(
        agg([permits(), permits({ operation_type: "home_kitchen" })])!.operation_type
      ).toBeNull()
    })

    it("sums advisory counts", () => {
      expect(agg([permits({ advisory_count: 2 }), permits({ advisory_count: 3 })])!
        .advisory_count).toBe(5)
    })

    it("ignores members with no profile rather than treating them as unset", () => {
      const out = agg([null, permits()])
      expect(out!.permit.status).toBe("ok")
    })
  })
})
