import {
  isPartnerKind,
  type PartnerEntry,
  type PartnerFilters,
  type PartnerKind,
} from "./types"

/**
 * The partner directory. Code is the source of truth, shaped like
 * `donation/fiscal-sponsors.ts`; served by `GET /store/partners` and read
 * by the lender and co-op quests as gatekeeper links, so no quest hard-codes
 * a URL that this table does not also carry.
 *
 * Three rules, restated from `docs/CDFI_COOP_ROADMAP.md` §3.2 so the table
 * cannot drift:
 *
 * 1. Link out; never intermediate. No application handoff, no lead form, no
 *    vendor data leaves FBM (Posture A rule 6).
 * 2. List only what works. An entry is a page a vendor can act on today —
 *    the `channel-connector/catalog.ts` rule. Curate; do not scrape. Every
 *    URL below was fetched at curation time; the ones a site refused to
 *    serve to an automated client carry `unverified_reason` and are for a
 *    reviewer to click once.
 * 3. No compensation. A referral fee or lead payment is a loan-brokering
 *    shape licensed state by state and not ruled on in
 *    `docs/REPO_CONSOLIDATION_REVIEW.md` §8. The directory is unpaid by
 *    construction.
 *
 * Generic entry points (locators and program pages) come first on purpose:
 * they work in every state. Named local lenders are added per launch region,
 * with `states`, once an operator has confirmed the page.
 *
 * Keep this visibly apart from `hawala-ledger`'s quiescent `VendorAdvance` /
 * `VendorCreditLine`: a directory exists because FBM does not lend.
 */
export const PARTNER_DIRECTORY: readonly PartnerEntry[] = [
  {
    key: "cdfi_fund_certified_list",
    name: "CDFI Fund — list of certified CDFIs",
    url: "https://www.cdfifund.gov/programs-training/certification/cdfi",
    tagline: "The U.S. Treasury's registry of certified community development lenders.",
    kind: "cdfi",
    states: "national",
    serves: ["sole_proprietor", "cooperative", "nonprofit", "farm"],
    products:
      "Downloadable list of every certified CDFI — loan funds, banks and credit unions — to find the ones lending in your area.",
  },
  {
    key: "ofn_cdfi_locator",
    name: "Opportunity Finance Network — CDFI locator",
    url: "https://www.ofn.org/cdfi-locator/",
    tagline: "Search OFN's member CDFIs by location and what they finance.",
    kind: "cdfi",
    states: "national",
    serves: ["sole_proprietor", "cooperative", "nonprofit", "farm"],
    products: "Searchable locator of member CDFIs offering small-business, microenterprise and community loans.",
    unverified_reason: "ofn.org answers automated requests with 403 (bot protection at the apex too).",
  },
  {
    key: "ncua_credit_union_locator",
    name: "NCUA — credit union locator",
    url: "https://mapping.ncua.gov/",
    tagline: "Find and research federally insured credit unions near you.",
    kind: "credit_union",
    states: "national",
    serves: ["sole_proprietor", "cooperative", "nonprofit", "farm"],
    products: "Locator and research tool for every federally insured credit union, including low-income-designated ones.",
  },
  {
    key: "sba_microloan_program",
    name: "SBA Microloan Program",
    url: "https://www.sba.gov/funding-programs/loans/microloans",
    tagline: "Loans up to $50,000 through SBA-approved nonprofit intermediaries.",
    kind: "microlender",
    states: "national",
    serves: ["sole_proprietor", "cooperative", "nonprofit"],
    products:
      "Microloans up to $50,000 (average about $13,000) for working capital, inventory, supplies and equipment, via a local intermediary the page helps you find.",
  },
  {
    key: "usda_fsa_microloans",
    name: "USDA FSA — farm microloans",
    url: "https://www.fsa.usda.gov/resources/programs/microloans",
    tagline: "Direct farm operating and ownership microloans from the Farm Service Agency.",
    kind: "microlender",
    states: "national",
    serves: ["farm"],
    products: "Operating and farm-ownership microloans up to $50,000 for small, beginning and niche farms.",
    unverified_reason:
      "fsa.usda.gov answered automated requests with 503; Q1 has carried this URL since it shipped.",
  },
  {
    key: "kiva_us",
    name: "Kiva U.S.",
    url: "https://www.kiva.org/borrow",
    tagline: "0% interest, no-fee loans of $1,000–$15,000 crowdfunded by lenders worldwide.",
    kind: "crowdfunder",
    states: "national",
    serves: ["sole_proprietor", "cooperative", "nonprofit", "farm"],
    products: "Zero-interest, fee-free loans of $1,000 to $15,000; you invite your own network first, then Kiva's lenders.",
  },
  {
    key: "honeycomb_credit",
    name: "Honeycomb Credit",
    url: "https://www.honeycombcredit.com/",
    tagline: "Community-investment loans raised from local investors.",
    kind: "crowdfunder",
    states: "national",
    serves: ["sole_proprietor", "cooperative"],
    products: "Regulation Crowdfunding loans where your customers and neighbours invest; you set the rate and terms.",
  },
  {
    key: "sba_local_assistance",
    name: "SBA — free local business counseling",
    url: "https://www.sba.gov/local-assistance",
    tagline: "Find an SBDC, SCORE mentor, Women's or Veterans Business Center near you.",
    kind: "back_office",
    states: "national",
    serves: ["sole_proprietor", "cooperative", "nonprofit", "farm"],
    products: "Free or low-cost counseling on business plans, loan packaging, bookkeeping and hiring, by location.",
  },
  {
    key: "co_op_law",
    name: "Co-op Law",
    url: "https://www.co-oplaw.org/",
    tagline: "Free legal resource library for democratic, worker-owned businesses.",
    kind: "legal",
    states: "national",
    serves: ["cooperative"],
    products: "Entity choice, bylaws, membership and governance guidance, with templates, for forming and running a cooperative.",
  },
  {
    key: "selc",
    name: "Sustainable Economies Law Center",
    url: "https://www.theselc.org/",
    tagline: "Legal support for cooperatives, community enterprises and the solidarity economy.",
    kind: "legal",
    states: "national",
    serves: ["cooperative", "nonprofit"],
    products: "Legal education, resources and referrals for co-ops, community land and food projects; rooted in California.",
    unverified_reason: "theselc.org answers automated requests with 403.",
  },
  {
    key: "usfwc_coop_clinic",
    name: "U.S. Federation of Worker Cooperatives — Co-op Clinic",
    url: "https://www.usworker.coop/clinic/startups/",
    tagline: "Startup resources and mini-guides for people forming a worker cooperative.",
    kind: "legal",
    states: "national",
    serves: ["cooperative"],
    products: "Startup checklists, downloadable mini-guides on worker ownership and conflict resolution, a monthly start-up webinar, and peer advisors who are current or former worker-owners.",
  },
  {
    key: "democracy_at_work_institute",
    name: "Democracy at Work Institute",
    url: "https://institute.coop/",
    tagline: "Worker co-op development, training and business conversions.",
    kind: "back_office",
    states: "national",
    serves: ["cooperative"],
    products: "Technical assistance for starting a worker cooperative or converting a business to worker ownership; training through the School for Democratic Management.",
  },
  {
    key: "usda_rd_cooperative_services",
    name: "USDA Rural Development — Cooperative Services",
    url: "https://www.rd.usda.gov/programs-services/cooperative-services",
    tagline: "Federal research, guides and grants for forming and running a cooperative.",
    kind: "back_office",
    states: "national",
    serves: ["cooperative"],
    products: "How-to-start guides, cooperative structure and finance research, and the Rural Cooperative Development Grant program that funds local co-op development centres.",
    unverified_reason: "rd.usda.gov answers automated requests with 403.",
  },

  // ── Fiscal sponsors (§3.3) ──────────────────────────────────────────────
  // Seeded from the display fields of `donation/fiscal-sponsors.ts`, never
  // from that registry directly: its `live` flag means FBM's own agreement
  // status, not whether the sponsor takes applicants, and a vendor's sponsor
  // is the vendor's own relationship. Its `selc_local` entry is a placeholder
  // for a per-region choice, not an entity anyone can apply to, so it is not
  // reproduced here.
  {
    key: "allied_media_projects",
    name: "Allied Media Projects",
    url: "https://alliedmedia.org",
    tagline: "Detroit-rooted fiscal sponsor for movement and solidarity-economy projects.",
    kind: "fiscal_sponsor",
    states: "national",
    serves: ["nonprofit", "cooperative"],
    products: "Comprehensive fiscal sponsorship for media, movement and solidarity-economy projects, with an application round and a sponsored-project network.",
  },
  {
    key: "neo_philanthropy",
    name: "NEO Philanthropy",
    url: "https://neophilanthropy.org",
    tagline: "National fiscal sponsor for social-change initiatives.",
    kind: "fiscal_sponsor",
    states: "national",
    serves: ["nonprofit"],
    products: "Fiscal sponsorship and fund management for social-justice initiatives, including grantmaking and back-office administration.",
  },
  {
    key: "tides_foundation",
    name: "Tides Foundation",
    url: "https://tides.org",
    tagline: "Broad-spectrum 501(c)(3) fiscal sponsor at scale.",
    kind: "fiscal_sponsor",
    states: "national",
    serves: ["nonprofit"],
    products: "Fiscal sponsorship, donor-advised funds and grantmaking infrastructure for projects that do not hold their own 501(c)(3).",
  },

  // ── Certifiers, inspection programs and the agencies behind them (§3.6) ──
  // A vendor is certified by these, never by FBM; the compliance quest lists
  // the certificate and links here. usda.gov properties answer automated
  // requests with 403, so several are recorded unverified for one human
  // click; they are the agencies' own program pages.
  {
    key: "usda_organic_integrity",
    name: "USDA Organic INTEGRITY database",
    url: "https://organic.ams.usda.gov/integrity/",
    tagline: "The register of accredited organic certifiers and certified operations.",
    kind: "certifier",
    states: "national",
    serves: ["farm", "sole_proprietor", "cooperative"],
    products: "Search accredited certifiers by state and look up any certified operation — the register your organic certificate appears in.",
    unverified_reason: "organic.ams.usda.gov is a client-side app that shows an error page to non-browser clients.",
  },
  {
    key: "usda_organic_becoming_certified",
    name: "USDA — becoming certified organic",
    url: "https://www.ams.usda.gov/services/organic-certification/becoming-certified",
    tagline: "The five steps to USDA organic certification and how to choose a certifier.",
    kind: "certifier",
    states: "national",
    serves: ["farm", "sole_proprietor", "cooperative"],
    products: "Eligibility, the organic system plan, choosing an accredited certifier, inspection and the annual renewal cycle.",
    unverified_reason: "ams.usda.gov answers automated requests with 403.",
  },
  {
    key: "certified_naturally_grown",
    name: "Certified Naturally Grown",
    url: "https://naturallygrown.org/",
    tagline: "Peer-reviewed certification for farms following organic practices without USDA certification.",
    kind: "certifier",
    states: "national",
    serves: ["farm", "sole_proprietor", "cooperative"],
    products: "Grassroots certification for produce, livestock, apiaries and mushrooms, with farmer-to-farmer inspections and lower fees than USDA Organic.",
    unverified_reason: "naturallygrown.org answers automated requests with 403 (the former cngfarming.org domain redirects here).",
  },
  {
    key: "usda_gap_ghp",
    name: "USDA GAP / GHP audits",
    url: "https://www.ams.usda.gov/services/auditing/gap-ghp",
    tagline: "Voluntary USDA food-safety audits many wholesale and institutional buyers require.",
    kind: "certifier",
    states: "national",
    serves: ["farm", "cooperative"],
    products: "Good Agricultural Practices and Good Handling Practices audits of growing, harvesting, packing and storage, scheduled through USDA AMS or a state department of agriculture.",
    unverified_reason: "ams.usda.gov answers automated requests with 403.",
  },
  {
    key: "nist_state_weights_measures",
    name: "NIST — state weights and measures directors",
    url: "https://www.nist.gov/pml/owm/resources-weights-and-measures/state-weights-and-measures-directors",
    tagline: "Every state's weights-and-measures office, which inspects and seals the scales you sell on.",
    kind: "certifier",
    states: "national",
    serves: ["sole_proprietor", "cooperative", "nonprofit", "farm"],
    products: "Contact for each state's device inspection and certification program — the certificate a vendor selling by weight is inspected on.",
  },
  {
    key: "national_plant_board_members",
    name: "National Plant Board — state plant regulatory officials",
    url: "https://www.nationalplantboard.org/members.html",
    tagline: "The state offices that license nurseries, inspect growing stock and issue plant movement certificates.",
    kind: "certifier",
    states: "national",
    serves: ["farm", "sole_proprietor", "cooperative"],
    products: "Directory of every state's plant regulatory office: nursery and plant-dealer licences, annual nursery inspections, and phytosanitary certificates for interstate shipping.",
  },
  {
    key: "usda_aphis_plant_exports",
    name: "USDA APHIS — plant and plant product exports",
    url: "https://www.aphis.usda.gov/plant-exports",
    tagline: "Phytosanitary certification for plants and plant products leaving the United States.",
    kind: "certifier",
    states: "national",
    serves: ["farm", "sole_proprietor", "cooperative"],
    products: "Export phytosanitary certificates and the PCIT system; interstate certificates come from your state plant regulatory official.",
  },
  {
    key: "usda_federal_seed_act",
    name: "USDA — Federal Seed Act",
    url: "https://www.ams.usda.gov/rules-regulations/fsa",
    tagline: "Seed labelling rules: lot, germination rate and test date on every packet.",
    kind: "certifier",
    states: "national",
    serves: ["farm", "sole_proprietor", "cooperative"],
    products: "Labelling and germination-testing requirements for agricultural and vegetable seed sold across state lines.",
    unverified_reason: "ams.usda.gov answers automated requests with 403.",
  },
]

const normalizeKinds = (kind: PartnerFilters["kind"]): PartnerKind[] | null => {
  if (!kind) return null
  const kinds = Array.isArray(kind) ? kind : [kind]
  return kinds.filter(isPartnerKind)
}

export function partnerMatches(entry: PartnerEntry, filters: PartnerFilters = {}): boolean {
  const kinds = normalizeKinds(filters.kind)
  if (kinds && !kinds.includes(entry.kind)) return false
  if (filters.serves && !entry.serves.includes(filters.serves)) return false
  if (filters.state) {
    const state = filters.state.toUpperCase()
    if (entry.states !== "national" && !entry.states.includes(state)) return false
  }
  return true
}

export function listPartners(filters: PartnerFilters = {}): PartnerEntry[] {
  return PARTNER_DIRECTORY.filter((entry) => partnerMatches(entry, filters))
}

export function getPartner(key: string): PartnerEntry | null {
  return PARTNER_DIRECTORY.find((entry) => entry.key === key) ?? null
}

/**
 * Gatekeeper links for a quest definition: the directory entries matching
 * the filter, in directory order, as `{ label, url }`. Definitions spread
 * these next to any links that are the gatekeeper's own pages, so the
 * directory is the one place a partner URL lives.
 */
export function partnerLinks(filters: PartnerFilters = {}): { label: string; url: string }[] {
  return listPartners(filters).map((entry) => ({ label: entry.name, url: entry.url }))
}
