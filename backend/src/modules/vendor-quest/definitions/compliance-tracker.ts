import type { QuestDefinition } from "../types"
import { partnerLinks } from "../../partner-directory"
import {
  disclaimer,
  WELLNESS_GUARDRAIL,
  verifiedDocsAtLeast,
  hasVerifiedDocType,
} from "./shared"

/**
 * Q8 — Compliance / Certification Tracker (Organic, Certified Naturally Grown,
 * GAP/GHP, weights-and-measures, nursery and seed compliance, cottage-food,
 * food-handler, wellness/practitioner credentials).
 *
 * Carries the wellness/health-claims guardrail: it documents regulatory
 * requirements and VERIFIED credentials only, and never implies clinical
 * authority.
 *
 * The certification vocabulary below was added 2026-09-07
 * (`docs/CDFI_COOP_ROADMAP.md` §3.6). Every certificate is vendor-supplied
 * or outside FBM: the seller declares, uploads, and is certified by the
 * agency the link names — FBM ships no state-law table and grants nothing
 * (the `cottage-food` rule). Items marked "if you…" apply only to vendors
 * who do that thing; a checklist item never blocks a gate. Until the
 * `organic_certification` and `device_certificate` vault types ship, those
 * certificates are uploaded as `credential`.
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
    // The certifiers and agencies live in the partner directory, never here.
    links: partnerLinks({ kind: "certifier" }),
  },
  usesFields: ["production", "documents"],
  requirements: [
    {
      key: "doc_checklist",
      label: "Document completion checklist",
      tag: "assisted",
      needs: ["documents"],
      // An assisted requirement with no predicate reads as satisfied the
      // moment the vault exists; this one is met by a verified document.
      satisfied: verifiedDocsAtLeast(1),
      note: "Met once at least one uploaded document has been verified by an FBM reviewer.",
    },
    { key: "production_records", label: "Production records", tag: "platform", needs: ["production"], note: "From your production ledger when enabled." },
    {
      key: "sourcing",
      label: "Sourcing records",
      tag: "vendor-supplied",
      note: "Where your inputs, seed and stock come from — invoices, seed tags, supplier declarations. Keep on file or upload; FBM has no record of them.",
    },
    { key: "inspection_forms", label: "Inspection forms", tag: "outside-fbm", note: "Filed with the certifier/inspector." },
    {
      key: "organic_certificate",
      label: "USDA Organic certificate (if you claim organic)",
      tag: "vendor-supplied",
      note: "Issued by an accredited certifier and listed in the USDA Organic INTEGRITY database. Upload as a credential; FBM never certifies.",
    },
    {
      key: "naturally_grown_certificate",
      label: "Certified Naturally Grown certificate (if you claim CNG)",
      tag: "vendor-supplied",
      note: "Peer-reviewed alternative to USDA Organic. Upload as a credential.",
    },
    {
      key: "gap_ghp_audit",
      label: "GAP / GHP food-safety audit (if a buyer requires one)",
      tag: "outside-fbm",
      note: "Scheduled with USDA AMS or your state department of agriculture; upload the audit certificate when you have it.",
    },
    {
      key: "device_certificate",
      label: "Weights-and-measures device certificate (if you sell by weight)",
      tag: "vendor-supplied",
      note: "Your state weights-and-measures office inspects and seals the scale you sell on. Upload the certificate as a credential.",
    },
    {
      key: "nursery_license",
      label: "State nursery or plant-dealer licence (if you sell live plants)",
      tag: "vendor-supplied",
      note: "Issued by your state plant regulatory official. Upload as a license.",
    },
    {
      key: "nursery_inspection",
      label: "Annual nursery inspection certificate (if you sell live plants)",
      tag: "vendor-supplied",
      note: "The state's yearly inspection of your growing stock. Upload as a credential.",
    },
    {
      key: "phytosanitary_certificate",
      label: "Phytosanitary certificate (if you ship live plants across state lines)",
      tag: "outside-fbm",
      note: "Issued per shipment by USDA APHIS or your state; obtained outside FBM.",
    },
    {
      key: "seed_labelling",
      label: "Seed-lot germination test and label (if you sell seed)",
      tag: "outside-fbm",
      note: "Federal Seed Act labelling: lot, germination rate and test date on every packet. Done outside FBM.",
    },
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
