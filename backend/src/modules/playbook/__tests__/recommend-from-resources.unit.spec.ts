import { recommendPlaybookFromResources } from "../recommend-from-resources"
import type { ResourceKey } from "../recommend-from-resources"
import { PLAYBOOK_IDS } from "../recipes"
import type { PlaybookId } from "../recipes"

const ALL_RESOURCES: ResourceKey[] = [
  "land",
  "time",
  "transportation",
  "materials_skills",
  "equipment",
  "audience",
  "network",
  "organization",
  "manufacturing",
  "marketing",
]

describe("recommendPlaybookFromResources", () => {
  it("land → a growing playbook (Cycle or Harvest)", () => {
    const r = recommendPlaybookFromResources(["land"])
    expect(["cycle", "harvest"]).toContain(r.playbook)
  })

  it("time only → Service", () => {
    const r = recommendPlaybookFromResources(["time"])
    expect(r.playbook).toBe("service")
  })

  it("transportation + network → Hub", () => {
    const r = recommendPlaybookFromResources(["transportation", "network"])
    expect(r.playbook).toBe("hub")
  })

  it("equipment → Kitchen", () => {
    const r = recommendPlaybookFromResources(["equipment"])
    expect(r.playbook).toBe("kitchen")
  })

  it("manufacturing → Atelier", () => {
    const r = recommendPlaybookFromResources(["manufacturing"])
    expect(r.playbook).toBe("atelier")
  })

  it("organization → Commons", () => {
    const r = recommendPlaybookFromResources(["organization"])
    expect(r.playbook).toBe("commons")
  })

  it("audience → Creator", () => {
    const r = recommendPlaybookFromResources(["audience"])
    expect(r.playbook).toBe("creator")
  })

  it("audience + marketing → Creator (an audience to monetize)", () => {
    const r = recommendPlaybookFromResources(["audience", "marketing"])
    expect(r.playbook).toBe("creator")
  })

  it("empty selection → Stall (the simplest default)", () => {
    const r = recommendPlaybookFromResources([])
    expect(r.playbook).toBe("stall")
  })

  it("returns a reason and up to three distinct alternatives", () => {
    const r = recommendPlaybookFromResources(["land", "time"])
    expect(r.reason.length).toBeGreaterThan(0)
    expect(r.alternatives.length).toBeGreaterThan(0)
    expect(r.alternatives.length).toBeLessThanOrEqual(3)
    expect(r.alternatives).not.toContain(r.playbook)
  })

  it("always returns one of the canonical playbooks for any single resource", () => {
    for (const key of ALL_RESOURCES) {
      const r = recommendPlaybookFromResources([key])
      expect(PLAYBOOK_IDS).toContain(r.playbook as PlaybookId)
    }
  })

  it("is deterministic — same input, same output", () => {
    const a = recommendPlaybookFromResources(["equipment", "time", "land"])
    const b = recommendPlaybookFromResources(["equipment", "time", "land"])
    expect(a).toEqual(b)
  })
})
