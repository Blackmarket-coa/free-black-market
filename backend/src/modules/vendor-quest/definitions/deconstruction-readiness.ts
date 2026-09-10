import type { QuestDefinition } from "../types"
import { partnerLinks } from "../../partner-directory"
import { disclaimer, hasVerifiedDocType, monthsActiveAtLeast } from "./shared"

/**
 * Q15 — Deconstruction Contractor Readiness.
 *
 * For a vendor who takes buildings apart rather than knocking them down, and
 * sells what comes out. The gatekeeper is whoever lets them on site: a
 * property owner, a general contractor, or the municipality issuing the
 * permit.
 *
 * `docs/TRANSMUTATION_STRATEGY.md` §4.4. Three lines that must not blur:
 *
 * - **FBM refers; it never underwrites.** Every gatekeeper link goes to a
 *   regulator or a trade body, and abatement links go to the *state agency
 *   that holds the licence list* rather than to any contractor. FBM does not
 *   vouch for a subcontractor's licence and takes nothing for the referral —
 *   a paid referral to an abatement contractor is FBM taking a cut of a
 *   hazmat job.
 * - **FBM ships no regulatory table.** Asbestos and lead rules are state law
 *   on top of federal, exactly as `modules/cottage-food` refuses to encode
 *   state cottage-food law. The vendor declares; the checklist points at who
 *   decides.
 * - **Abatement is not renovation, and the quest says so.** Salvage in
 *   pre-1978 housing is usually renovation under the EPA's RRP rule rather
 *   than abatement, and the two carry different certifications. A checklist
 *   that conflates them sends someone after the wrong credential, which is
 *   worse than no checklist.
 *
 * Marked `safetyCritical`, so the full requirement list — notes included — is
 * published to the unauthenticated catalog rather than sitting behind the
 * `vendor.quests` entitlement. See the flag's docblock in `../types.ts` for
 * why that exemption is drawn where it is.
 */
const deconstructionReadiness: QuestDefinition = {
  key: "deconstruction-readiness",
  category: "Certification & Trust",
  title: "Deconstruction Contractor Readiness",
  outcome: "A record a property owner or GC can accept before letting you on site",
  type: "individual",
  safetyCritical: true,
  gatekeeper: {
    name: "the property owner, general contractor or permitting authority",
    disclaimer: disclaimer("The property owner or authority having jurisdiction"),
    links: partnerLinks({
      kind: ["abatement", "deconstruction", "reuse_center", "test_lab"],
    }),
  },
  usesFields: ["documents"],
  requirements: [
    {
      key: "contractor_license",
      label: "Contractor licence for your state",
      tag: "vendor-supplied",
      needs: ["documents"],
      satisfied: hasVerifiedDocType("license"),
      note: "Whatever your state requires to do structural or demolition work. Upload it to your vault as a licence; it counts once an FBM reviewer verifies the document is what it says it is. FBM does not check it against your state's register — the authority having jurisdiction does that.",
    },
    {
      key: "general_liability",
      label: "General liability certificate, current",
      tag: "vendor-supplied",
      needs: ["documents"],
      satisfied: hasVerifiedDocType("insurance"),
      note: "Most property owners will not let you start without one. Upload the certificate with its coverage window so the vault can tell you before it lapses.",
    },
    {
      key: "workers_comp",
      label: "Workers' compensation coverage",
      tag: "vendor-supplied",
      note: "Required in nearly every state once you have employees, and commonly demanded of sole operators by the GC anyway. Rules and exemptions are state law; your carrier or state board is the authority, not this checklist.",
    },
    {
      key: "hazard_assessment",
      label: "Pre-work hazard assessment",
      tag: "vendor-supplied",
      note: "A written survey of the building before anything is disturbed: suspected asbestos-containing materials, lead paint, PCB-containing caulk and light ballasts, mercury switches. In a pre-1980 building, assume asbestos is present until a survey says otherwise.",
    },
    {
      key: "abatement_subcontractor",
      label: "Licensed abatement subcontractor, if hazards are present",
      tag: "outside-fbm",
      note: "Asbestos and lead abatement are licensed state by state and are not work you do because you own a respirator. Your state's asbestos programme holds the list of who is licensed — that is the link above. FBM makes no introduction, verifies no licence and is paid nothing.",
    },
    {
      key: "rrp_certification",
      label: "RRP firm certification, for pre-1978 housing",
      tag: "vendor-supplied",
      needs: ["documents"],
      satisfied: hasVerifiedDocType("credential"),
      note: "Separate from abatement, and more often the one that applies. Disturbing paint in a pre-1978 home or child-occupied facility is renovation under the EPA's Renovation, Repair and Painting rule, which needs a certified firm and a trained renovator on site — even when no abatement is involved.",
    },
    {
      key: "disposal_plan",
      label: "Disposal and diversion plan",
      tag: "vendor-supplied",
      note: "Where each stream goes: what is resold, what is recycled, what is landfilled, and which facility takes the regulated waste. Keep the manifests — a diversion figure you cannot evidence is a claim, not a record.",
    },
    {
      key: "reuse_outlet",
      label: "An outlet for what you recover",
      tag: "platform",
      satisfied: (s) => (s.operating.listing_count ?? 0) > 0,
      note: "Your own FBM listings count. Deconstruction only pays if the material has somewhere to go; reuse centres in the links above take what you do not want to list yourself.",
    },
    {
      key: "operating_history",
      label: "Operating history",
      tag: "platform",
      satisfied: monthsActiveAtLeast(3),
      note: "Assembled from your FBM record.",
    },
  ],
  stageGates: [
    {
      key: "insured",
      label: "Insured",
      order: 1,
      description: "Cover in place before anyone lets you on a site.",
      unlocks: hasVerifiedDocType("insurance"),
      missing: (s) =>
        hasVerifiedDocType("insurance")(s)
          ? []
          : ["A verified general liability certificate in your vault"],
    },
    {
      key: "licensed",
      label: "Licensed",
      order: 2,
      description: "Licence and trade record on file.",
      unlocks: (s) =>
        hasVerifiedDocType("insurance")(s) &&
        hasVerifiedDocType("license")(s) &&
        monthsActiveAtLeast(3)(s),
      missing: (s) => {
        const out: string[] = []
        if (!hasVerifiedDocType("insurance")(s)) out.push("A verified general liability certificate")
        if (!hasVerifiedDocType("license")(s)) out.push("A verified contractor licence")
        if (!monthsActiveAtLeast(3)(s)) out.push("3 months of operating history")
        return out
      },
    },
    {
      key: "site_ready",
      label: "Site-Ready",
      order: 3,
      description:
        "Hazard-trained as well as licensed, with somewhere for the material to go.",
      unlocks: (s) =>
        hasVerifiedDocType("insurance")(s) &&
        hasVerifiedDocType("license")(s) &&
        hasVerifiedDocType("credential")(s) &&
        monthsActiveAtLeast(6)(s) &&
        (s.operating.listing_count ?? 0) > 0,
      missing: (s) => {
        const out: string[] = []
        if (!hasVerifiedDocType("insurance")(s)) out.push("A verified general liability certificate")
        if (!hasVerifiedDocType("license")(s)) out.push("A verified contractor licence")
        if (!hasVerifiedDocType("credential")(s)) {
          out.push("A verified RRP or hazard-training credential")
        }
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of operating history")
        if ((s.operating.listing_count ?? 0) === 0) {
          out.push("At least one listing, so recovered material has an outlet")
        }
        return out
      },
    },
  ],
  packetTemplate: {
    key: "deconstruction-readiness-bundle",
    title: "Deconstruction Readiness Bundle",
    sections: [
      {
        key: "operating",
        title: "Operating History",
        build: (s) => ({
          available: true,
          data: {
            since: s.operating.account_created_at,
            months_active: s.operating.months_active,
            listings: s.operating.listing_count,
            orders_fulfilled: s.operating.orders_fulfilled,
          },
        }),
      },
      {
        key: "credentials",
        title: "Licences, insurance and credentials (verified state shown)",
        build: (s) => ({
          available: s.documents != null,
          data: s.documents?.documents ?? [],
          note: s.documents
            ? "Verified means an FBM reviewer confirmed the document is what it says it is. It is not a check against your state's register."
            : "No documents uploaded.",
        }),
      },
    ],
    remainingItems: () => [
      "The pre-work hazard assessment for this specific building",
      "Your abatement subcontractor's own licence, obtained from them directly",
      "The disposal and diversion plan, with the receiving facilities named",
      "Any municipal deconstruction or demolition permit the job needs",
    ],
  },
}

export default deconstructionReadiness
