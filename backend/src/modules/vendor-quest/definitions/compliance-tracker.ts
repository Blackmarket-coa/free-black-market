import type { QuestDefinition } from "../types"
import {
  disclaimer,
  WELLNESS_GUARDRAIL,
  verifiedDocsAtLeast,
  hasVerifiedDocType,
} from "./shared"

/**
 * Q8 — Compliance / Certification Tracker (Organic, Certified Naturally Grown,
 * cottage-food, food-handler, wellness/practitioner credentials).
 *
 * Carries the wellness/health-claims guardrail: it documents regulatory
 * requirements and VERIFIED credentials only, and never implies clinical
 * authority.
 */
const complianceTracker: QuestDefinition = {
  key: "compliance-tracker",
  category: "Certification & Trust",
  title: "Compliance / Certification Tracker",
  outcome: "Certification-ready document set (gaps flagged)",
  type: "individual",
  healthClaimsGuardrail: true,
  gatekeeper: {
    name: "the certifier / health department",
    disclaimer: `${disclaimer("The certifier or health department")} ${WELLNESS_GUARDRAIL}`,
    links: [],
  },
  usesFields: ["production", "documents"],
  requirements: [
    { key: "doc_checklist", label: "Document completion checklist", tag: "assisted", needs: ["documents"], note: "Tracks which required docs are uploaded + verified." },
    { key: "production_records", label: "Production records", tag: "platform", needs: ["production"], note: "From your production ledger when enabled." },
    { key: "sourcing", label: "Sourcing", tag: "assisted", note: "Assembled from records; you confirm." },
    { key: "inspection_forms", label: "Inspection forms", tag: "outside-fbm", note: "Filed with the certifier/inspector." },
  ],
  stageGates: [
    {
      key: "started",
      label: "Started",
      order: 1,
      unlocks: (s) => (s.documents?.documents.length ?? 0) >= 1,
      missing: (s) => ((s.documents?.documents.length ?? 0) >= 1 ? [] : ["Upload at least one required document"]),
    },
    {
      key: "documented",
      label: "Documented",
      order: 2,
      unlocks: (s) => verifiedDocsAtLeast(1)(s),
      missing: (s) => (verifiedDocsAtLeast(1)(s) ? [] : ["At least one verified document"]),
    },
    {
      key: "cert_ready",
      label: "Certification-Ready",
      order: 3,
      unlocks: (s) => hasVerifiedDocType("license")(s) || hasVerifiedDocType("credential")(s),
      missing: (s) =>
        hasVerifiedDocType("license")(s) || hasVerifiedDocType("credential")(s)
          ? []
          : ["A verified license or credential on file"],
    },
  ],
  packetTemplate: {
    key: "certification-checklist",
    title: "Certification Checklist & Evidence",
    sections: [
      {
        key: "documents",
        title: "Documents (verified state shown)",
        build: (s) => ({
          available: s.documents != null,
          data: s.documents?.documents ?? [],
          note: s.documents ? undefined : "No documents uploaded.",
        }),
      },
      {
        key: "production_records",
        title: "Production Records",
        build: (s) => ({
          available: s.production != null,
          data: s.production,
          note: s.production ? undefined : "No production ledger in use for this vendor.",
        }),
      },
    ],
    remainingItems: (s) => {
      const items: string[] = ["Inspection / certification forms (filed with the certifier)"]
      if (!hasVerifiedDocType("license")(s)) items.push("Verified license (upload + FBM review)")
      return items
    },
  },
}

export default complianceTracker
