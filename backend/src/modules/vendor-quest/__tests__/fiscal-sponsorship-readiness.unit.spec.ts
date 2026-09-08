import { getQuestDefinition } from "../definitions"
import { evaluateQuest } from "../engine"
import { aggregateSubstrates } from "../substrate/aggregate"
import { partnerLinks } from "../../partner-directory"
import { makeSubstrate } from "./_fixtures"
import type { FundsSummary, VendorSubstrate } from "../types"

/**
 * Q14 `fiscal-sponsorship-readiness` (`docs/CDFI_COOP_ROADMAP.md` §3.3).
 *
 * The lines this quest must not blur: the sponsor is the vendor's own
 * relationship, FBM never drafts the agreement, and the fund-ledger
 * requirement must degrade to "unavailable" rather than becoming a second
 * paywall for a vendor without fund accounting.
 */

const q14 = getQuestDefinition("fiscal-sponsorship-readiness")!

const requirement = (key: string) => q14.requirements.find((r) => r.key === key)!

const status = (key: string, s: VendorSubstrate) =>
  evaluateQuest(q14, s).requirements.find((r) => r.key === key)!.status

const funds = (over: Partial<FundsSummary> = {}): FundsSummary => ({
  fund_count: 1,
  currency_code: "usd",
  awarded_cents: 500_000,
  received_cents: 500_000,
  spent_cents: 100_000,
  cash_available_cents: 400_000,
  violation_count: 0,
  ...over,
})

describe("Q14 fiscal-sponsorship-readiness — links and posture", () => {
  it("takes its links from the directory's fiscal sponsors", () => {
    expect(q14.gatekeeper.links).toEqual(partnerLinks({ kind: "fiscal_sponsor" }))
    expect(q14.gatekeeper.links.length).toBeGreaterThan(0)
    for (const link of q14.gatekeeper.links) {
      expect(link.url).toMatch(/^https:\/\//)
      expect(Object.keys(link).sort()).toEqual(["label", "url"])
    }
  })

  it("leaves the sponsor's application and agreement outside FBM", () => {
    const application = requirement("sponsor_application")
    expect(application.tag).toBe("outside-fbm")
    expect(application.satisfied).toBeUndefined()
    expect(application.note).toMatch(/drafts no agreement/i)

    const remaining = q14.packetTemplate!.remainingItems(makeSubstrate())
    expect(remaining.some((r) => /sponsor drafts it/i.test(r))).toBe(true)
  })

  it("is an individual quest in the mission category", () => {
    expect(q14.type).toBe("individual")
    expect(q14.category).toBe("Cooperative & Mission")
  })
})

describe("Q14 — the fund ledger degrades instead of paywalling", () => {
  it("reads unavailable, not unsatisfied, when the vendor keeps no funds", () => {
    // A vendor without fund accounting has no fund rows, so `buildFunds`
    // returns null and the engine reports the field as absent.
    const s = makeSubstrate()
    expect(s.funds).toBeNull()
    expect(status("budget_and_fund_ledger", s)).toBe("unavailable")
    expect(status("clean_fund_compliance", s)).toBe("unavailable")
  })

  it("satisfies both fund lines once a clean portfolio exists", () => {
    const s = makeSubstrate({ funds: funds() })
    expect(status("budget_and_fund_ledger", s)).toBe("satisfied")
    expect(status("clean_fund_compliance", s)).toBe("satisfied")
  })

  it("fails the compliance line when the ledger already disagrees with the grantor", () => {
    const s = makeSubstrate({ funds: funds({ violation_count: 2 }) })
    expect(status("clean_fund_compliance", s)).toBe("unsatisfied")
  })

  it("does not hold the top gate against a vendor who keeps no fund ledger", () => {
    const base = {
      operating: { ...makeSubstrate().operating, months_active: 24 },
      documents: {
        documents: [
          { id: "d1", doc_type: "contract", label: "Bylaws", verified: true, expires_at: null },
        ],
      },
    }
    const withoutFunds = makeSubstrate(base)
    const withDirtyFunds = makeSubstrate({ ...base, funds: funds({ violation_count: 1 }) })

    const gate = (s: VendorSubstrate) =>
      evaluateQuest(q14, s).stages.find((g) => g.key === "sponsor_ready")!

    expect(gate(withoutFunds).open).toBe(true)
    expect(gate(withDirtyFunds).open).toBe(false)
  })
})

describe("funds substrate field", () => {
  it("is null by default and unions across a collective", () => {
    const none = makeSubstrate()
    const a = makeSubstrate({ funds: funds({ fund_count: 1, awarded_cents: 100 }) })
    const b = makeSubstrate({ funds: funds({ fund_count: 2, awarded_cents: 250, violation_count: 1 }) })

    expect(aggregateSubstrates([none, none], ["x", "y"]).funds).toBeNull()

    const combined = aggregateSubstrates([a, b, none], ["a", "b", "c"]).funds!
    expect(combined.fund_count).toBe(3)
    expect(combined.awarded_cents).toBe(350)
    expect(combined.violation_count).toBe(1)
  })
})
