import { recommendPlaybook } from "../recommend"
import type {
  SizeAnswer,
  GovernanceAnswer,
  OfferingAnswer,
  PickerAnswers,
} from "../recommend"
import { PLAYBOOK_IDS } from "../recipes"
import type { PlaybookId } from "../recipes"

const allSizes: SizeAnswer[] = ["solo", "small", "medium", "federation"]
const allGovernances: GovernanceAnswer[] = [
  "i_decide",
  "informal_agreement",
  "circles",
  "elected_reps",
  "federation_council",
]
const allOfferings: OfferingAnswer[] = [
  "make_or_grow",
  "services",
  "subscription_or_season",
  "kitchen_food",
  "harvest_pool",
  "aggregator",
]

describe("recommendPlaybook", () => {
  it("solo + I decide + things I make → Stall", () => {
    const r = recommendPlaybook({
      size: "solo",
      governance: "i_decide",
      offering: "make_or_grow",
    })
    expect(r.playbook).toBe("stall")
    expect(r.reason).toMatch(/Stall/)
  })

  it("solo + I decide + services → Service", () => {
    const r = recommendPlaybook({
      size: "solo",
      governance: "i_decide",
      offering: "services",
    })
    expect(r.playbook).toBe("service")
  })

  it("small + informal + things I make → Atelier", () => {
    const r = recommendPlaybook({
      size: "small",
      governance: "informal_agreement",
      offering: "make_or_grow",
    })
    expect(r.playbook).toBe("atelier")
  })

  it("medium + circles + things I make → Workshop", () => {
    const r = recommendPlaybook({
      size: "medium",
      governance: "circles",
      offering: "make_or_grow",
    })
    expect(r.playbook).toBe("workshop")
  })

  it("medium + elected reps + things I make → Commons", () => {
    const r = recommendPlaybook({
      size: "medium",
      governance: "elected_reps",
      offering: "make_or_grow",
    })
    expect(r.playbook).toBe("commons")
  })

  it("small + informal + kitchen food → Kitchen", () => {
    const r = recommendPlaybook({
      size: "small",
      governance: "informal_agreement",
      offering: "kitchen_food",
    })
    expect(r.playbook).toBe("kitchen")
  })

  it("small + informal + harvest pool → Harvest", () => {
    const r = recommendPlaybook({
      size: "small",
      governance: "informal_agreement",
      offering: "harvest_pool",
    })
    expect(r.playbook).toBe("harvest")
  })

  it("federation + federation council + aggregator → Hub", () => {
    const r = recommendPlaybook({
      size: "federation",
      governance: "federation_council",
      offering: "aggregator",
    })
    expect(r.playbook).toBe("hub")
  })

  it("small + informal + subscription or season → Cycle", () => {
    const r = recommendPlaybook({
      size: "small",
      governance: "informal_agreement",
      offering: "subscription_or_season",
    })
    expect(r.playbook).toBe("cycle")
  })

  it("solo + I decide + services → Service (not Stall — Stall blocks Service offering)", () => {
    const r = recommendPlaybook({
      size: "solo",
      governance: "i_decide",
      offering: "services",
    })
    expect(r.playbook).toBe("service")
  })

  it("returns one of the canonical playbooks for every (size × governance × offering) combination", () => {
    for (const size of allSizes) {
      for (const governance of allGovernances) {
        for (const offering of allOfferings) {
          const answers: PickerAnswers = { size, governance, offering }
          const r = recommendPlaybook(answers)
          expect(PLAYBOOK_IDS).toContain(r.playbook as PlaybookId)
        }
      }
    }
  })

  it("ties between Stall and Atelier resolve to Stall on the simpler-playbook rule", () => {
    // solo + I decide + make_or_grow: intersection is {stall, atelier, service}
    // after narrowing to make_or_grow set {stall, atelier, ...}.
    // The simplicity tiebreak places Stall first.
    const r = recommendPlaybook({
      size: "solo",
      governance: "i_decide",
      offering: "make_or_grow",
    })
    expect(r.playbook).toBe("stall")
  })

  it("provides alternatives the user can override to", () => {
    const r = recommendPlaybook({
      size: "small",
      governance: "informal_agreement",
      offering: "make_or_grow",
    })
    expect(r.alternatives.length).toBeGreaterThan(0)
    expect(r.alternatives).not.toContain(r.playbook)
  })

  it("falls back gracefully when governance excludes every member of the size set", () => {
    // solo + federation_council is an unnatural combo (no one solo uses a
    // federation council). The recommender should still produce a valid
    // playbook rather than throwing.
    const r = recommendPlaybook({
      size: "solo",
      governance: "federation_council",
      offering: "make_or_grow",
    })
    expect(PLAYBOOK_IDS).toContain(r.playbook as PlaybookId)
  })
})
