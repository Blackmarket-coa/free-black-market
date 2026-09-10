import { GET } from "../route"
import { QUEST_DEFINITIONS } from "../../../../modules/vendor-quest/definitions"

/**
 * The public quest catalog, and the safety exemption on it.
 *
 * Quests are gated on FF_VENDOR_QUESTS_V1 plus the `vendor.quests` plan
 * feature. For a capital-readiness quest that is pricing; for a checklist
 * meant to stop someone disturbing asbestos it is a paywall on safety content.
 * A `safetyCritical` quest therefore publishes its whole requirement list
 * here, notes included. docs/TRANSMUTATION_STRATEGY.md §4.4.
 */

const createRes = () => {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  res.set = (name: string, value: string) => {
    res.headers[name] = value
    return res
  }
  return res
}

const run = async () => {
  const res = createRes()
  await GET({} as any, res)
  return res.body as {
    quests: Array<{
      key: string
      safety_critical: boolean
      requirements?: Array<{ key: string; label: string; tag: string; note: string | null }>
      requirement_counts: Record<string, number>
    }>
    categories: string[]
    access: { plans: unknown[]; addons: unknown[]; safety_critical_note: string }
  }
}

describe("GET /store/quest-catalog", () => {
  it("lists every definition", async () => {
    const body = await run()
    expect(body.quests).toHaveLength(QUEST_DEFINITIONS.length)
  })

  it("publishes the full checklist for a safety-critical quest", async () => {
    const body = await run()
    const quest = body.quests.find((q) => q.key === "deconstruction-readiness")!

    expect(quest.safety_critical).toBe(true)
    expect(quest.requirements).toBeDefined()
    expect(quest.requirements).toHaveLength(
      QUEST_DEFINITIONS.find((d) => d.key === "deconstruction-readiness")!.requirements.length
    )

    // The notes are the part that is actually useful to someone about to open
    // a wall, so they are the part that must survive serialization.
    const abatement = quest.requirements!.find((r) => r.key === "abatement_subcontractor")!
    expect(abatement.note).toBeTruthy()
    expect(abatement.tag).toBe("outside-fbm")
  })

  it("still withholds the checklist for a gated quest", async () => {
    // The exemption is narrow on purpose: this is not a general unlocking of
    // the catalog.
    const body = await run()
    for (const quest of body.quests) {
      if (quest.safety_critical) continue
      expect(quest.requirements).toBeUndefined()
      expect(Object.keys(quest.requirement_counts).length).toBeGreaterThan(0)
    }
  })

  it("publishes no predicate, only static content", async () => {
    // `satisfied` is a function over a vendor's substrate. Serializing one
    // would be meaningless at best and a leak at worst.
    const body = await run()
    const quest = body.quests.find((q) => q.safety_critical)!
    for (const requirement of quest.requirements!) {
      expect(Object.keys(requirement).sort()).toEqual(["key", "label", "note", "tag"])
    }
  })

  it("says in words that some checklists are free", async () => {
    const body = await run()
    expect(body.access.safety_critical_note).toMatch(/free/i)
    expect(body.access.safety_critical_note).toMatch(/enrol/i)
  })

  it("still reports the gating for everything else", async () => {
    const body = await run()
    expect(body.access.plans.length).toBeGreaterThan(0)
  })
})
