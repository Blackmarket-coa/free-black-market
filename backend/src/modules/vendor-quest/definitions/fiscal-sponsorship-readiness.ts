import type { QuestDefinition } from "../types"
import { partnerLinks } from "../../partner-directory"
import { disclaimer, hasVerifiedDocType, monthsActiveAtLeast } from "./shared"

/**
 * Q14 — Fiscal Sponsorship Readiness.
 *
 * For a project that is charitable in PURPOSE and not (yet) a 501(c)(3): a
 * mutual-aid pod, a community fridge, a garden, a free store. A fiscal sponsor
 * lends its exempt status so the project can receive grants and deductible
 * gifts without incorporating first.
 *
 * `docs/CDFI_COOP_ROADMAP.md` §3.3. Three lines that must not blur:
 *
 * - **This is not the co-op path.** A for-profit worker co-op is directed to
 *   Q11 `coop-formation`; fiscal sponsorship is not the instrument for an
 *   enterprise that distributes surplus to its members.
 * - **The sponsor is the vendor's own relationship.** FBM's own arrangement
 *   covers FBM's checkout donations, not a vendor's project. FBM makes no
 *   introduction and is paid nothing.
 * - **FBM never drafts the agreement.** The sponsorship agreement is the
 *   sponsor's own instrument. The links go out to sponsors; the application is
 *   `outside-fbm` and stays there.
 *
 * The fund-ledger requirement reads "unavailable" rather than unsatisfied for
 * a vendor without fund accounting, because `buildFunds` returns null on an
 * empty portfolio. That is deliberate: the quest must not become a second
 * paywall on top of the quest pack.
 */
const fiscalSponsorshipReadiness: QuestDefinition = {
  key: "fiscal-sponsorship-readiness",
  category: "Cooperative & Mission",
  title: "Fiscal Sponsorship Readiness",
  outcome: "A project record a fiscal sponsor can evaluate",
  type: "individual",
  gatekeeper: {
    name: "the fiscal sponsor you apply to",
    disclaimer: disclaimer("Your fiscal sponsor"),
    // Sponsors come from the partner registry, never from the donation
    // module's sponsor list: that list tracks FBM's own agreement status.
    links: partnerLinks({ kind: "fiscal_sponsor" }),
  },
  usesFields: ["documents", "funds"],
  requirements: [
    {
      key: "project_purpose",
      label: "Project purpose statement",
      tag: "vendor-supplied",
      note: "What the project does and who it serves, in your own words. A sponsor is lending you its charitable status, so the purpose has to be one its own exemption covers.",
    },
    {
      key: "governing_document",
      label: "Governing document",
      tag: "vendor-supplied",
      needs: ["documents"],
      // Upload type is `contract` until the vault gains a governing-document
      // type (§3.4, Tier B item 11); the predicate follows the type, not the
      // other way round, so this stays vendor-supplied for now.
      note: "Bylaws, a decision-making agreement or a memorandum of understanding. Draft from the scaffolds in Blackout's Coalition tools, then upload to your vault as a contract.",
    },
    {
      key: "operating_history",
      label: "Operating history",
      tag: "platform",
      satisfied: monthsActiveAtLeast(3),
      note: "Assembled from your FBM record — three months of activity is enough to show a sponsor the project is real.",
    },
    {
      key: "budget_and_fund_ledger",
      label: "Budget and fund ledger",
      tag: "assisted",
      needs: ["funds"],
      satisfied: (s) => (s.funds?.fund_count ?? 0) > 0,
      note: "Assembled from your restricted-fund records when you track them here. Optional: a sponsor will accept your own budget, and this line reads \"unavailable\" rather than incomplete if you do not use fund accounting.",
    },
    {
      key: "clean_fund_compliance",
      label: "No unresolved fund-compliance breaks",
      tag: "assisted",
      needs: ["funds"],
      satisfied: (s) => s.funds != null && s.funds.violation_count === 0,
      note: "Every recorded spend cites the settlement that moved the money and stays inside its grant's designation.",
    },
    {
      key: "sponsor_application",
      label: "The sponsor's own application",
      tag: "outside-fbm",
      note: "Applied for directly with the sponsor, on their form and their timeline. FBM makes no introduction, drafts no agreement and is paid nothing for the referral.",
    },
    {
      key: "verified_credential",
      label: "A verified credential or licence (if your work needs one)",
      tag: "vendor-supplied",
      needs: ["documents"],
      satisfied: hasVerifiedDocType("license"),
      note: "Food handling, childcare, health practice — whatever your project's activity requires. Not every project needs one.",
    },
  ],
  stageGates: [
    {
      key: "forming",
      label: "Forming",
      order: 1,
      description: "A project with enough history to describe itself.",
      unlocks: monthsActiveAtLeast(3),
      missing: (s) =>
        monthsActiveAtLeast(3)(s) ? [] : ["3 months of operating history"],
    },
    {
      key: "documented",
      label: "Documented",
      order: 2,
      description: "A governing document on file, verified.",
      unlocks: (s) => monthsActiveAtLeast(6)(s) && (s.documents?.documents.length ?? 0) > 0,
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(6)(s)) out.push("6 months of operating history")
        if ((s.documents?.documents.length ?? 0) === 0) {
          out.push("A governing document uploaded to your vault")
        }
        return out
      },
    },
    {
      key: "sponsor_ready",
      label: "Sponsor-Ready",
      order: 3,
      description: "A year of history and a clean fund record, if you keep one.",
      unlocks: (s) =>
        monthsActiveAtLeast(12)(s) &&
        (s.documents?.documents.some((d) => d.verified) ?? false) &&
        (s.funds == null || s.funds.violation_count === 0),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(12)(s)) out.push("12 months of operating history")
        if (!(s.documents?.documents.some((d) => d.verified) ?? false)) {
          out.push("A verified governing document")
        }
        if (s.funds != null && s.funds.violation_count > 0) {
          out.push("Resolve the open fund-compliance breaks")
        }
        return out
      },
    },
  ],
  packetTemplate: {
    key: "fiscal-sponsorship-bundle",
    title: "Fiscal Sponsorship Bundle",
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
        key: "reach",
        title: "Who the project reaches",
        build: (s) => ({
          available: true,
          data: {
            distinct_people_served: s.customers.distinct_customers,
            returning: s.customers.repeat_customers,
          },
        }),
      },
      {
        key: "funds",
        title: "Restricted Funds",
        build: (s) => ({
          available: s.funds != null,
          data: s.funds ?? {},
          note: s.funds
            ? undefined
            : "No fund records — a sponsor will accept your own budget instead.",
        }),
      },
      {
        key: "documents",
        title: "Governing Documents (verified state shown)",
        build: (s) => ({
          available: s.documents != null,
          data: s.documents?.documents ?? [],
          note: s.documents ? undefined : "No documents uploaded.",
        }),
      },
    ],
    remainingItems: () => [
      "Project purpose statement, in your own words",
      "The sponsor's own application form",
      "The sponsorship agreement (the sponsor drafts it; FBM never does)",
      "A board or steward list, if the sponsor asks for one",
    ],
  },
}

export default fiscalSponsorshipReadiness
