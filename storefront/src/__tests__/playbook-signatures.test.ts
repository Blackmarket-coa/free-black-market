import { describe, expect, it } from "vitest"
import {
  getPlaybookLabel,
  isPlaybookId,
  PLAYBOOK_IDS,
  PLAYBOOK_LABELS,
  type PlaybookId,
} from "@/components/atoms/PlaybookSignature/signatures"

describe("playbook signatures: id taxonomy", () => {
  it("exposes the ten canonical playbooks in stable order", () => {
    expect(PLAYBOOK_IDS).toEqual([
      "stall",
      "atelier",
      "grove",
      "workshop",
      "commons",
      "cycle",
      "kitchen",
      "harvest",
      "hub",
      "service",
    ])
  })

  it("ships exactly one label per playbook id", () => {
    expect(Object.keys(PLAYBOOK_LABELS).sort()).toEqual([...PLAYBOOK_IDS].sort())
    for (const id of PLAYBOOK_IDS) {
      expect(PLAYBOOK_LABELS[id]).toBeTruthy()
    }
  })

  it("labels are capitalised single words matching the id", () => {
    for (const id of PLAYBOOK_IDS) {
      expect(PLAYBOOK_LABELS[id].toLowerCase()).toBe(id)
    }
  })
})

describe("playbook signatures: isPlaybookId", () => {
  it.each(PLAYBOOK_IDS)("accepts %s", (id) => {
    expect(isPlaybookId(id)).toBe(true)
  })

  it.each([
    "Stall",
    "STALL",
    "marketplace",
    "",
    null,
    undefined,
    42,
    {},
    [],
  ])("rejects %p", (val) => {
    expect(isPlaybookId(val)).toBe(false)
  })
})

describe("playbook signatures: getPlaybookLabel", () => {
  it("returns the label for known ids", () => {
    expect(getPlaybookLabel("atelier")).toBe("Atelier")
    expect(getPlaybookLabel("service")).toBe("Service")
  })

  it("returns an empty string for unknown ids", () => {
    expect(getPlaybookLabel(null)).toBe("")
    expect(getPlaybookLabel(undefined)).toBe("")
    expect(getPlaybookLabel("nonsense")).toBe("")
    expect(getPlaybookLabel("ATELIER" as unknown as PlaybookId)).toBe("")
  })
})
