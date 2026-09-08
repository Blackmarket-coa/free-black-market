import { getQuestDefinition } from "../definitions"
import { evaluateQuest } from "../engine"
import {
  BLACKOUT_APP_URL_FALLBACK,
  blackoutCoalitionUrl,
  coopFoundingDocumentLinks,
} from "../../../shared/coop-founding-links"
import { listPartners, partnerLinks } from "../../partner-directory"
import { makeSubstrate } from "./_fixtures"

/**
 * Q11 `coop-formation` after the founding-document wiring of 2026-09-07
 * (`docs/CDFI_COOP_ROADMAP.md` §3.4): the gatekeeper links come from Blackout
 * plus the partner registry with nothing hard-coded, and the bylaws
 * requirement stays a vendor-supplied checklist item that FBM never satisfies
 * on the vendor's behalf.
 */

const q11 = getQuestDefinition("coop-formation")!

const requirement = (key: string) => q11.requirements.find((r) => r.key === key)!

describe("Q11 coop-formation — founding-document links", () => {
  it("builds its links from Blackout plus the co-op rows of the registry", () => {
    expect(q11.gatekeeper.links).toEqual(coopFoundingDocumentLinks())
    expect(q11.gatekeeper.links[0].url).toBe(`${BLACKOUT_APP_URL_FALLBACK}/coalition`)
    expect(q11.gatekeeper.links.slice(1)).toEqual(
      partnerLinks({ kind: ["legal", "back_office"], serves: "cooperative" })
    )
    for (const link of q11.gatekeeper.links) {
      expect(link.url).toMatch(/^https:\/\//)
      expect(Object.keys(link).sort()).toEqual(["label", "url"])
    }
  })

  it("carries the SELC and USFWC libraries a vendor can reach without Blackout", () => {
    const urls = q11.gatekeeper.links.map((l) => l.url)
    expect(urls).toContain("https://www.theselc.org/")
    expect(urls).toContain("https://www.usworker.coop/clinic/startups/")
    // The USDA page used to be hard-coded in the definition; it is a registry
    // row now, so it reaches the progression edges too.
    expect(urls).toContain("https://www.rd.usda.gov/programs-services/cooperative-services")
    expect(listPartners({ kind: "legal", serves: "cooperative" }).length).toBeGreaterThan(1)
  })

  it("honours BLACKOUT_APP_URL when one is configured", () => {
    const previous = process.env.BLACKOUT_APP_URL
    process.env.BLACKOUT_APP_URL = "https://blackout.example.test/"
    try {
      expect(blackoutCoalitionUrl()).toBe("https://blackout.example.test/coalition")
    } finally {
      if (previous === undefined) delete process.env.BLACKOUT_APP_URL
      else process.env.BLACKOUT_APP_URL = previous
    }
  })
})

describe("Q11 coop-formation — the bylaws requirement", () => {
  const bylawsStatus = (docs: { doc_type: string; verified: boolean }[]) =>
    evaluateQuest(
      q11,
      makeSubstrate({
        documents: {
          documents: docs.map((d, i) => ({
            id: `d${i}`,
            label: "Bylaws",
            expires_at: null,
            ...d,
          })),
        },
      })
    ).requirements.find((r) => r.key === "governance_bylaws")!.status

  /**
   * Retagged `assisted` once the vault gained a `governing_document` type
   * (Tier B item 11). An `assisted` requirement with no predicate reads as
   * satisfied unconditionally, so the predicate is what makes the tag safe.
   */
  it("reads a verified governing document, and nothing else", () => {
    const bylaws = requirement("governance_bylaws")
    expect(bylaws.tag).toBe("assisted")
    expect(bylaws.satisfied).toBeDefined()

    expect(bylawsStatus([{ doc_type: "governing_document", verified: true }])).toBe("satisfied")
    // Unverified, and the older `contract` upload, both fall short — FBM
    // never counts a document it has not checked.
    expect(bylawsStatus([{ doc_type: "governing_document", verified: false }])).toBe("unsatisfied")
    expect(bylawsStatus([{ doc_type: "contract", verified: true }])).toBe("unsatisfied")
  })

  it("moves no stage gate, because Q11's gates never read documents", () => {
    const withDoc = makeSubstrate({
      operating: { ...makeSubstrate().operating, months_active: 24 },
      revenue: { ...makeSubstrate().revenue, lifetime_revenue: 50_000 },
      collective: { member_count: 4, member_ids: ["a", "b", "c", "d"] },
      documents: {
        documents: [
          { id: "d1", doc_type: "governing_document", label: "Bylaws", verified: true, expires_at: null },
        ],
      },
    })
    const withoutDoc = makeSubstrate({
      operating: { ...makeSubstrate().operating, months_active: 24 },
      revenue: { ...makeSubstrate().revenue, lifetime_revenue: 50_000 },
      collective: { member_count: 4, member_ids: ["a", "b", "c", "d"] },
    })
    const gates = (s: typeof withDoc) =>
      evaluateQuest(q11, s).stages.map((g) => `${g.key}:${g.open}`)

    expect(gates(withoutDoc)).toEqual(gates(withDoc))
  })

  it("tells the vendor it is their own vault, not a shared one", () => {
    const note = requirement("governance_bylaws").note ?? ""
    expect(note).toMatch(/your own vault/i)
    expect(note).not.toMatch(/shared vault/i)
    expect(note).toMatch(/documents scope/i)
  })

  it("still refuses to generate the incorporation filing", () => {
    const incorporation = requirement("incorporation")
    expect(incorporation.tag).toBe("outside-fbm")
    expect(incorporation.note).toMatch(/never generates legal filings/i)
  })
})
