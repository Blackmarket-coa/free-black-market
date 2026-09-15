/**
 * Q16 — the coalition-only quest.
 *
 * Two properties are the whole point and neither can regress quietly:
 *
 *   - no coalition, no progress: an ordinary collective sees the quest and
 *     gets told plainly what it needs, rather than grinding at a gate that
 *     cannot open;
 *   - the milestone is JOINT: a drive one member funded alone does not count,
 *     because the coalition showing up is the thing being recognised.
 *
 * Also pinned here: adding the `coalition` field changed no other quest's
 * evaluation. It is a domain-optional substrate field like `funds` — null for
 * everyone who is not a coalition.
 */
import { aggregateSubstrates } from "../substrate/aggregate"
import { evaluateQuest } from "../engine"
import { getQuestDefinition } from "../definitions"
import { makeSubstrate } from "./_fixtures"
import type { CollectiveCoalitionInfo, VendorSubstrate } from "../types"

const q16 = getQuestDefinition("coalition-drive")!

function coalitionSubstrate(
  coalition: CollectiveCoalitionInfo | null,
  memberCount = 3
): VendorSubstrate {
  const members = Array.from({ length: memberCount }, () => makeSubstrate())
  const ids = members.map((_, i) => `sel_${i}`)
  return aggregateSubstrates(members, ids, { coalition })
}

const coalition = (over: Partial<CollectiveCoalitionInfo> = {}): CollectiveCoalitionInfo => ({
  coalition_id: "coa_1",
  drives_completed: 0,
  contributing_members: 0,
  raised_cents: 0,
  ...over,
})

describe("Q16 coalition drive", () => {
  it("is registered as a collective quest with no packet", () => {
    expect(q16.type).toBe("collective")
    expect(q16.packetTemplate).toBeNull()
  })

  it("opens no gate for a collective with no coalition behind it", () => {
    const evaluation = evaluateQuest(q16, coalitionSubstrate(null))
    expect(evaluation.stages.every((s) => !s.open)).toBe(true)
    expect(evaluation.stages[0].missing).toContain(
      "Link this collective to a Blackout coalition"
    )
  })

  it("opens the first gate once a coalition with member shops is linked", () => {
    const evaluation = evaluateQuest(q16, coalitionSubstrate(coalition()))
    expect(evaluation.stages[0].open).toBe(true)
    expect(evaluation.stages[1].open).toBe(false)
  })

  it("does not count a drive that one member funded alone", () => {
    // A closed drive, but only one contributor: the coalition did not show up.
    const evaluation = evaluateQuest(
      q16,
      coalitionSubstrate(coalition({ drives_completed: 1, contributing_members: 1 }))
    )
    expect(evaluation.stages[1].open).toBe(false)
    expect(evaluation.stages[1].missing).toContain("3 members contributing to a drive")
  })

  it("opens the milestone gate on a jointly funded, completed drive", () => {
    const evaluation = evaluateQuest(
      q16,
      coalitionSubstrate(coalition({ drives_completed: 1, contributing_members: 4 }))
    )
    expect(evaluation.stages[1].open).toBe(true)
    expect(evaluation.stages[2].open).toBe(false)
  })

  it("opens the final gate only on a sustained record", () => {
    const evaluation = evaluateQuest(
      q16,
      coalitionSubstrate(coalition({ drives_completed: 3, contributing_members: 5 }))
    )
    expect(evaluation.stages.every((s) => s.open)).toBe(true)
  })

  it("never scales with money raised", () => {
    // Reputation and capital stay structurally separate: a coalition that
    // raised a fortune on one contributor is no further along than one that
    // raised nothing on one contributor.
    const rich = evaluateQuest(
      q16,
      coalitionSubstrate(coalition({ drives_completed: 1, contributing_members: 1, raised_cents: 50_000_00 }))
    )
    const poor = evaluateQuest(
      q16,
      coalitionSubstrate(coalition({ drives_completed: 1, contributing_members: 1, raised_cents: 0 }))
    )
    expect(rich.stages.map((s) => s.open)).toEqual(poor.stages.map((s) => s.open))
  })

  it("leaves other collective quests evaluating exactly as before", () => {
    const q11 = getQuestDefinition("coop-formation")!
    const withCoalition = coalitionSubstrate(coalition({ drives_completed: 9 }), 4)
    const withoutCoalition = coalitionSubstrate(null, 4)
    expect(evaluateQuest(q11, withCoalition).stages.map((s) => s.open)).toEqual(
      evaluateQuest(q11, withoutCoalition).stages.map((s) => s.open)
    )
  })

  it("defaults the coalition field to null when the caller passes none", () => {
    const agg = aggregateSubstrates([makeSubstrate()], ["sel_a"])
    expect(agg.collective?.coalition).toBeNull()
  })
})
