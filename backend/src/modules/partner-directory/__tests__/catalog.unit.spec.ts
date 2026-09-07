import {
  PARTNER_DIRECTORY,
  PARTNER_KINDS,
  PARTNER_SERVES,
  getPartner,
  listPartners,
  partnerLinks,
  partnerMatches,
} from ".."

/**
 * The directory is a promise to a vendor: every entry is a page they can act
 * on today, linked out, unpaid. These checks hold the table to its own rules
 * (`docs/CDFI_COOP_ROADMAP.md` §3.2) so a careless edit cannot ship a broken
 * or misfiled entry.
 */
describe("partner directory — shape", () => {
  it("has unique keys and only https URLs", () => {
    const keys = PARTNER_DIRECTORY.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const entry of PARTNER_DIRECTORY) {
      expect(entry.url).toMatch(/^https:\/\/[^\s"'<>]+$/)
      expect(entry.name.trim().length).toBeGreaterThan(0)
      expect(entry.tagline.trim().length).toBeGreaterThan(0)
      expect(entry.products.trim().length).toBeGreaterThan(0)
    }
  })

  it("files every entry under a known kind, audience and state list", () => {
    for (const entry of PARTNER_DIRECTORY) {
      expect(PARTNER_KINDS).toContain(entry.kind)
      expect(entry.serves.length).toBeGreaterThan(0)
      for (const s of entry.serves) expect(PARTNER_SERVES).toContain(s)
      if (entry.states !== "national") {
        expect(entry.states.length).toBeGreaterThan(0)
        for (const st of entry.states) expect(st).toMatch(/^[A-Z]{2}$/)
      }
    }
  })

  it("carries no field a lender could pay for or a vendor could be handed to", () => {
    for (const entry of PARTNER_DIRECTORY) {
      const keys = Object.keys(entry)
      for (const forbidden of ["fee", "commission", "referral_fee", "apply_url", "lead_url", "contact_email"]) {
        expect(keys).not.toContain(forbidden)
      }
    }
  })

  it("covers the generic entry points the lender quests link to", () => {
    expect(getPartner("cdfi_fund_certified_list")?.kind).toBe("cdfi")
    expect(getPartner("kiva_us")?.kind).toBe("crowdfunder")
    expect(getPartner("usda_fsa_microloans")?.serves).toEqual(["farm"])
    expect(getPartner("missing")).toBeNull()
  })
})

describe("partner directory — filters", () => {
  it("filters by one kind or several", () => {
    expect(listPartners({ kind: "crowdfunder" }).map((e) => e.key)).toEqual(["kiva_us", "honeycomb_credit"])
    const lenders = listPartners({ kind: ["cdfi", "microlender"] })
    expect(lenders.every((e) => e.kind === "cdfi" || e.kind === "microlender")).toBe(true)
    expect(lenders.length).toBeGreaterThanOrEqual(3)
  })

  it("filters by audience", () => {
    for (const entry of listPartners({ serves: "farm" })) expect(entry.serves).toContain("farm")
    expect(listPartners({ serves: "farm" }).map((e) => e.key)).toContain("usda_fsa_microloans")
    expect(listPartners({ serves: "farm" }).map((e) => e.key)).not.toContain("co_op_law")
  })

  it("a state filter keeps national entries and drops ones for other states", () => {
    const all = listPartners()
    expect(listPartners({ state: "sc" })).toEqual(all.filter((e) => e.states === "national"))
    const regional = { ...all[0], key: "regional", states: ["GA"] as const }
    expect(partnerMatches(regional, { state: "ga" })).toBe(true)
    expect(partnerMatches(regional, { state: "SC" })).toBe(false)
    expect(partnerMatches(regional, {})).toBe(true)
  })

  it("ignores unknown kinds rather than matching everything", () => {
    expect(listPartners({ kind: ["nope" as never] })).toEqual([])
  })

  it("renders quest links as label + url in directory order", () => {
    const links = partnerLinks({ kind: ["cdfi", "crowdfunder"] })
    expect(links[0]).toEqual({
      label: "CDFI Fund — list of certified CDFIs",
      url: "https://www.cdfifund.gov/programs-training/certification/cdfi",
    })
    expect(links.map((l) => l.label)).toContain("Kiva U.S.")
    for (const link of links) expect(Object.keys(link).sort()).toEqual(["label", "url"])
  })
})
