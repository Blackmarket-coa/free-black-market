import VendorQuestModuleService from "../service"
import { listQuestDefinitions } from "../definitions"

/**
 * The vendor catalog serializer carries the definition's gatekeeper links.
 * Until 2026-09-06 it dropped them, so an enrolled vendor never saw where to
 * take a finished packet while the public `/quests` page did
 * (`docs/CDFI_COOP_ROADMAP.md` §3.1). Prototype-only service instance, as in
 * `decoupling.unit.spec.ts`: `getCatalog` is pure config.
 */
describe("vendor quest catalog — gatekeeper links", () => {
  const service = Object.create(VendorQuestModuleService.prototype) as VendorQuestModuleService

  it("returns every definition's links, verbatim, on its catalog entry", () => {
    const catalog = service.getCatalog()
    const definitions = listQuestDefinitions()
    expect(catalog).toHaveLength(definitions.length)

    for (const def of definitions) {
      const entry = catalog.find((e) => e.key === def.key)!
      expect(entry.gatekeeper).toBe(def.gatekeeper.name)
      expect(entry.gatekeeper_links).toEqual(def.gatekeeper.links ?? [])
    }
    // The catalog is not all empty lists: at least one quest links out.
    expect(catalog.some((e) => e.gatekeeper_links.length > 0)).toBe(true)
  })
})
