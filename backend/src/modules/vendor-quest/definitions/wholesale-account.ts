import type { QuestDefinition } from "../types"
import {
  disclaimer,
  monthsActiveAtLeast,
  ordersFulfilledAtLeast,
  fulfillmentReliabilityAtLeast,
  listingsAtLeast,
} from "./shared"

/**
 * Q5 — Wholesale Account Readiness.
 */
const wholesaleAccount: QuestDefinition = {
  key: "wholesale-account",
  category: "Market Access & Growth",
  title: "Wholesale Account Readiness",
  outcome: "Qualify to sell to shops / co-ops / distributors",
  type: "individual",
  gatekeeper: {
    name: "the buyer / retail account",
    disclaimer: disclaimer("The wholesale buyer or retail account"),
    links: [],
  },
  usesFields: ["inventory", "channels", "documents"],
  requirements: [
    { key: "fulfillment_reliability", label: "Fulfillment reliability", tag: "platform", satisfied: fulfillmentReliabilityAtLeast(0.9) },
    { key: "capacity", label: "Capacity / volume history", tag: "platform", satisfied: ordersFulfilledAtLeast(20) },
    { key: "line_sheet", label: "Line sheet", tag: "assisted", note: "Drafted from your listings + channel pricing." },
    { key: "insurance", label: "Insurance", tag: "vendor-supplied", note: "Upload a certificate of insurance." },
    { key: "samples_certs", label: "Samples / certifications", tag: "vendor-supplied", note: "Provide on request." },
  ],
  stageGates: [
    {
      key: "operating",
      label: "Operating",
      order: 1,
      unlocks: (s) => monthsActiveAtLeast(3)(s) && ordersFulfilledAtLeast(5)(s),
      missing: (s) => {
        const out: string[] = []
        if (!monthsActiveAtLeast(3)(s)) out.push("3 months of operating history")
        if (!ordersFulfilledAtLeast(5)(s)) out.push("5 fulfilled orders")
        return out
      },
    },
    {
      key: "reliable",
      label: "Reliable",
      order: 2,
      unlocks: (s) => fulfillmentReliabilityAtLeast(0.9)(s) && ordersFulfilledAtLeast(20)(s),
      missing: (s) => {
        const out: string[] = []
        if (!fulfillmentReliabilityAtLeast(0.9)(s)) out.push("Proven 90%+ fulfillment reliability")
        if (!ordersFulfilledAtLeast(20)(s)) out.push("20 fulfilled orders")
        return out
      },
    },
    {
      key: "wholesale_ready",
      label: "Wholesale-Ready",
      order: 3,
      unlocks: (s) => ordersFulfilledAtLeast(50)(s) && listingsAtLeast(5)(s),
      missing: (s) => {
        const out: string[] = []
        if (!ordersFulfilledAtLeast(50)(s)) out.push("50 fulfilled orders (capacity)")
        if (!listingsAtLeast(5)(s)) out.push("5 active listings for a line sheet")
        return out
      },
    },
  ],
  packetTemplate: {
    key: "wholesale-line-sheet",
    title: "Wholesale Line Sheet & Capacity Proof",
    sections: [
      {
        key: "line_sheet",
        title: "Line Sheet",
        build: (s) => ({
          available: true,
          data: { listings: s.operating.listing_count, channels: s.channels?.channels ?? [] },
        }),
      },
      {
        key: "capacity",
        title: "Capacity & Reliability",
        build: (s) => ({
          available: true,
          data: {
            orders_fulfilled: s.operating.orders_fulfilled,
            fulfillment_reliability: s.operating.fulfillment_reliability,
            on_hand_units: s.inventory?.on_hand_units ?? null,
          },
        }),
      },
    ],
    remainingItems: () => ["Certificate of insurance", "Product samples / certifications", "Wholesale terms sheet"],
  },
}

export default wholesaleAccount
