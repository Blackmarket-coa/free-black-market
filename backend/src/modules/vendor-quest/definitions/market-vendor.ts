import type { QuestDefinition } from "../types"
import { disclaimer, monthsActiveAtLeast, listingsAtLeast } from "./shared"

/**
 * Q6 — Market / Co-op Vendor Application (farmers-market stall / co-op membership).
 */
const marketVendor: QuestDefinition = {
  key: "market-vendor",
  category: "Market Access & Growth",
  title: "Market / Co-op Vendor Application",
  outcome: "Farmers-market stall or co-op vendor membership",
  type: "individual",
  gatekeeper: {
    name: "the market manager / co-op",
    disclaimer: disclaimer("The market manager or co-op"),
    links: [],
  },
  usesFields: ["production", "documents"],
  requirements: [
    { key: "product_list", label: "Product list", tag: "platform", satisfied: listingsAtLeast(1) },
    { key: "sourcing_docs", label: "Sourcing / production docs", tag: "assisted", needs: ["production"], note: "From your production ledger when enabled." },
    { key: "licenses", label: "Licenses", tag: "vendor-supplied", note: "Upload required licenses." },
    { key: "membership_forms", label: "Membership forms", tag: "outside-fbm", note: "Completed with the market/co-op." },
  ],
  stageGates: [
    {
      key: "listed",
      label: "Listed",
      order: 1,
      unlocks: (s) => listingsAtLeast(1)(s),
      missing: (s) => (listingsAtLeast(1)(s) ? [] : ["At least one active listing"]),
    },
    {
      key: "documented",
      label: "Documented",
      order: 2,
      unlocks: (s) => monthsActiveAtLeast(3)(s) && listingsAtLeast(3)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(3)(s)) out.push("3 months of operating history")
        if (!listingsAtLeast(3)(s)) out.push("3 active listings")
        return out
      },
    },
    {
      key: "application_ready",
      label: "Application-Ready",
      order: 3,
      unlocks: (s) => monthsActiveAtLeast(6)(s),
      missing: (s) => (monthsActiveAtLeast(6)(s) ? [] : ["6 months of operating history"]),
    },
  ],
  packetTemplate: {
    key: "vendor-application-bundle",
    title: "Vendor Application Bundle",
    sections: [
      {
        key: "products",
        title: "Product List",
        build: (s) => ({ available: true, data: { listings: s.operating.listing_count } }),
      },
      {
        key: "sourcing",
        title: "Sourcing / Production",
        build: (s) => ({
          available: s.production != null,
          data: s.production,
          note: s.production ? undefined : "No production ledger in use for this vendor.",
        }),
      },
    ],
    remainingItems: () => ["Required licenses / permits", "Market or co-op membership forms"],
  },
}

export default marketVendor
