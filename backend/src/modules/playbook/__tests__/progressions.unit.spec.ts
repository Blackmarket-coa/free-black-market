import { readFileSync } from "fs"
import { join } from "path"

import {
  PROGRESSION_EDGES,
  PROGRESSION_ENGINES,
  TERMINAL_PLAYBOOKS,
  ENGINE_LABELS,
  progressionsFrom,
  findEdge,
  isProgression,
  diffPlaybooks,
  resolveProgression,
  resolveProgressionsFrom,
  groupByEngine,
  commonlyLeadsTo,
} from "../progressions"
import { PLAYBOOK_IDS, PLAYBOOK_RECIPES } from "../recipes"
import type { PlaybookId } from "../recipes"
import { QUEST_DEFINITIONS } from "../../vendor-quest/definitions"

const DOC_PATH = join(__dirname, "../../../../../docs/VENDOR_PROGRESSIONS.md")
const STOREFRONT_PAGE_PATH = join(
  __dirname,
  "../../../../../storefront/src/app/[locale]/(main)/vendor-types/page.tsx"
)

/**
 * Drift guard for the progression graph.
 *
 * The edge set is hand-authored data referencing three other places — the
 * playbook ids, the quest registry, and the table in `docs/VENDOR_PROGRESSIONS.md`
 * — and none of those would fail loudly on their own if an edge drifted. This
 * is the same pattern as `seller-extension/__tests__/vendor-type.unit.spec.ts`,
 * which exists because `creator` was added to two enums and missed in five
 * dependent sites.
 */
describe("playbook progressions", () => {
  describe("edge integrity", () => {
    it("every from/to is a real playbook id", () => {
      for (const edge of PROGRESSION_EDGES) {
        expect(PLAYBOOK_IDS).toContain(edge.from)
        expect(PLAYBOOK_IDS).toContain(edge.to)
      }
    })

    it("has no self-edges", () => {
      const selfEdges = PROGRESSION_EDGES.filter((e) => e.from === e.to)
      expect(selfEdges).toEqual([])
    })

    it("has no duplicate from→to pairs", () => {
      const seen = new Set<string>()
      const duplicates: string[] = []
      for (const edge of PROGRESSION_EDGES) {
        const key = `${edge.from}->${edge.to}`
        if (seen.has(key)) duplicates.push(key)
        seen.add(key)
      }
      expect(duplicates).toEqual([])
    })

    it("every edge declares at least one known engine", () => {
      for (const edge of PROGRESSION_EDGES) {
        expect(edge.engines.length).toBeGreaterThan(0)
        for (const engine of edge.engines) {
          expect(PROGRESSION_ENGINES).toContain(engine)
        }
      }
    })

    it("every engine has a vendor-facing label and at least one edge", () => {
      for (const engine of PROGRESSION_ENGINES) {
        expect(ENGINE_LABELS[engine]).toBeTruthy()
        expect(
          PROGRESSION_EDGES.some((e) => e.engines.includes(engine))
        ).toBe(true)
      }
    })

    it("every edge carries a headline and a ceiling", () => {
      for (const edge of PROGRESSION_EDGES) {
        expect(edge.headline.trim().length).toBeGreaterThan(0)
        expect(edge.ceiling.trim().length).toBeGreaterThan(0)
      }
    })

    it("kind is replace or add_role", () => {
      for (const edge of PROGRESSION_EDGES) {
        expect(["replace", "add_role"]).toContain(edge.kind)
      }
    })
  })

  describe("cross-module references", () => {
    it("every quest_key resolves in the quest registry", () => {
      const questKeys = QUEST_DEFINITIONS.map((q) => q.key)
      for (const edge of PROGRESSION_EDGES) {
        if (!edge.quest_key) continue
        expect(questKeys).toContain(edge.quest_key)
      }
    })
  })

  describe("graph coverage", () => {
    it("every playbook is either a source or a declared terminal", () => {
      for (const id of PLAYBOOK_IDS) {
        const hasOutbound = progressionsFrom(id).length > 0
        const isTerminal = TERMINAL_PLAYBOOKS.includes(id)
        // A playbook with no way forward and no terminal declaration is an
        // oversight, not a design decision — fail loudly and say which.
        expect(hasOutbound || isTerminal).toBe(true)
      }
    })

    it("declared terminals really have no outbound edges", () => {
      for (const id of TERMINAL_PLAYBOOKS) {
        expect(progressionsFrom(id)).toEqual([])
      }
    })

    it("hub is the terminal rung", () => {
      expect(TERMINAL_PLAYBOOKS).toEqual(["hub"])
    })

    it("every playbook is reachable as a target except the entry-only ones", () => {
      // Every playbook should be somewhere on the map — either you can get to
      // it, or you can leave it. An id in neither list is orphaned.
      for (const id of PLAYBOOK_IDS) {
        const reachable = PROGRESSION_EDGES.some((e) => e.to === id)
        const leavable = PROGRESSION_EDGES.some((e) => e.from === id)
        expect(reachable || leavable).toBe(true)
      }
    })
  })

  describe("diffPlaybooks", () => {
    it("reports listing-types lost, not only gained", () => {
      // The motivating case: a home baker moving to a licensed kitchen keeps
      // selling, but Kitchen does not allow the digital / one-of-a-kind /
      // campaign listings Stall does. Surfacing only gains would be an upsell.
      const diff = diffPlaybooks("stall", "kitchen")
      expect(diff.listingTypesLost).toEqual(
        expect.arrayContaining(["digital", "unique_inventory", "campaign"])
      )
      expect(diff.listingTypesGained).toEqual(
        expect.arrayContaining(["wholesale", "bookable"])
      )
    })

    it("reports feature keys in both directions", () => {
      const diff = diffPlaybooks("stall", "kitchen")
      expect(diff.featuresGained).toEqual(
        expect.arrayContaining(["hasMenu", "hasDeliveryZones"])
      )
      // Stall has hasSupport; Kitchen's recipe does not enable it.
      expect(diff.featuresLost).toContain("hasSupport")
    })

    it("commission is unchanged across every edge (3 % under Posture A)", () => {
      for (const edge of PROGRESSION_EDGES) {
        expect(diffPlaybooks(edge.from, edge.to).commissionDelta).toBe(0)
      }
    })

    it("is symmetric — a gain one way is a loss the other", () => {
      const forward = diffPlaybooks("stall", "kitchen")
      const back = diffPlaybooks("kitchen", "stall")
      expect(forward.listingTypesGained.sort()).toEqual(
        back.listingTypesLost.sort()
      )
      expect(forward.listingTypesLost.sort()).toEqual(
        back.listingTypesGained.sort()
      )
    })
  })

  describe("lookups", () => {
    it("findEdge and isProgression agree", () => {
      expect(findEdge("stall", "kitchen")).toBeDefined()
      expect(isProgression("stall", "kitchen")).toBe(true)
      // Not a declared progression — a legal switch, just not a ladder rung.
      expect(findEdge("kitchen", "stall")).toBeUndefined()
      expect(isProgression("kitchen", "stall")).toBe(false)
    })

    it("resolveProgression attaches the target's display copy and diff", () => {
      const edge = findEdge("stall", "kitchen")!
      const resolved = resolveProgression(edge)
      expect(resolved.to_display_name).toBe(PLAYBOOK_RECIPES.kitchen.display_name)
      expect(resolved.to_member_model).toBe(PLAYBOOK_RECIPES.kitchen.member_model)
      expect(resolved.diff.listingTypesLost.length).toBeGreaterThan(0)
    })

    it("groupByEngine lists an edge under each engine it declares", () => {
      // stall→atelier is both governance and facility; it belongs in both.
      const groups = groupByEngine(resolveProgressionsFrom("stall"))
      const governance = groups.find((g) => g.engine === "governance")
      const facility = groups.find((g) => g.engine === "facility")
      expect(governance?.edges.some((e) => e.to === "atelier")).toBe(true)
      expect(facility?.edges.some((e) => e.to === "atelier")).toBe(true)
    })

    it("groupByEngine omits engines with no edges", () => {
      const groups = groupByEngine(resolveProgressionsFrom("creator"))
      // Creator's edges are audience/governance only — no land engine.
      expect(groups.map((g) => g.engine)).not.toContain("land")
      for (const group of groups) {
        expect(group.edges.length).toBeGreaterThan(0)
      }
    })

    it("commonlyLeadsTo returns deduped display names", () => {
      const names = commonlyLeadsTo("stall")
      expect(names.length).toBe(new Set(names).size)
      expect(names).toContain(PLAYBOOK_RECIPES.kitchen.display_name)
    })

    it("a terminal playbook resolves to an empty list, not an error", () => {
      expect(resolveProgressionsFrom("hub")).toEqual([])
      expect(groupByEngine(resolveProgressionsFrom("hub"))).toEqual([])
      expect(commonlyLeadsTo("hub")).toEqual([])
    })
  })

  describe("docs/VENDOR_PROGRESSIONS.md parity", () => {
    const doc = readFileSync(DOC_PATH, "utf8")

    /** Rows of the edge table: `| from | to | kind | engines | … |`. */
    const docEdges = doc
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\|\s*[a-z_]+\s*\|\s*[a-z_]+\s*\|\s*(replace|add_role)\s*\|/.test(line))
      .map((line) => {
        const cells = line.split("|").map((c) => c.trim())
        // cells[0] is the empty string before the leading pipe.
        return { from: cells[1] as PlaybookId, to: cells[2] as PlaybookId, kind: cells[3] }
      })

    it("documents every edge in the code", () => {
      const codeKeys = PROGRESSION_EDGES.map((e) => `${e.from}->${e.to}`).sort()
      const docKeys = docEdges.map((e) => `${e.from}->${e.to}`).sort()
      expect(docKeys).toEqual(codeKeys)
    })

    it("documents the same kind for every edge", () => {
      for (const docEdge of docEdges) {
        const edge = findEdge(docEdge.from, docEdge.to)
        expect(edge).toBeDefined()
        expect(docEdge.kind).toBe(edge!.kind)
      }
    })

    it("states the edge count the code actually has", () => {
      expect(doc).toContain(`${PROGRESSION_EDGES.length} edges`)
    })
  })

  describe("storefront vendor-types page parity", () => {
    // The public page is hand-written marketing copy, so its "commonly leads
    // to" map is a copy of this graph rather than a fetch. Same reasoning as
    // the `recommend-from-resources` mirror documented in PLAYBOOK_SYSTEM.md:
    // a copy is fine as long as something fails when it drifts.
    const page = readFileSync(STOREFRONT_PAGE_PATH, "utf8")

    const parsedLeadsTo = (): Record<string, string[]> => {
      const block = page.match(
        /const leadsTo: Record<string, string\[\]> = \{([\s\S]*?)\n {2}\}/
      )
      expect(block).not.toBeNull()
      const out: Record<string, string[]> = {}
      for (const line of block![1].split("\n")) {
        const row = line.match(/^\s*(\w+):\s*\[(.*)\],?\s*$/)
        if (!row) continue
        out[row[1]] = row[2]
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean)
      }
      return out
    }

    it("matches commonlyLeadsTo for every playbook", () => {
      const fromPage = parsedLeadsTo()
      for (const id of PLAYBOOK_IDS) {
        const displayName = PLAYBOOK_RECIPES[id].display_name
        const expected = commonlyLeadsTo(id)
        if (expected.length === 0) {
          // Terminal playbooks are omitted from the page rather than listed
          // with an empty array.
          expect(fromPage[displayName]).toBeUndefined()
          continue
        }
        expect(fromPage[displayName]).toEqual(expected)
      }
    })

    it("lists no playbook the code doesn't know about", () => {
      const known = PLAYBOOK_IDS.map((id) => PLAYBOOK_RECIPES[id].display_name)
      for (const [source, targets] of Object.entries(parsedLeadsTo())) {
        expect(known).toContain(source)
        for (const target of targets) {
          expect(known).toContain(target)
        }
      }
    })
  })
})
