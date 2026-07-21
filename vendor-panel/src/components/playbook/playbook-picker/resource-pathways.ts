/**
 * Resource → non-vendor pathway hints, shown on the resource quiz's reveal
 * step. The quiz routes people into vendor playbooks, but several resources
 * also map to ways of participating in FBM that don't require running a
 * storefront at all (driving for Blackstar, volunteering through Threshold,
 * claiming Refrain bounties, backing collective campaigns). These hints make
 * registration inclusive beyond selling.
 *
 * Purely presentational — no backend mirror. Each entry names the module
 * family that backs it so copy stays honest as features evolve.
 */

import type { ResourceKey } from "./recommend-from-resources"

export type ResourcePathway = {
  /** Selecting any of these resources surfaces the pathway. */
  resources: ResourceKey[]
  title: string
  description: string
  emoji: string
}

export const RESOURCE_PATHWAYS: ResourcePathway[] = [
  {
    resources: ["transportation"],
    title: "Drive deliveries",
    description:
      "Deliver for local vendors through Blackstar — no surge pricing, fair dispatch, and you set your own availability.",
    emoji: "🚚",
  },
  {
    resources: ["time"],
    title: "Volunteer & bank your hours",
    description:
      "Join work parties, log volunteer hours, and earn time credits — no storefront needed.",
    emoji: "⏰",
  },
  {
    resources: ["capital"],
    title: "Back community campaigns",
    description:
      "Fund collective campaigns, demand pools, and mutual-aid funds as a supporter.",
    emoji: "💰",
  },
  {
    resources: ["goods", "equipment"],
    title: "Give through mutual aid",
    description:
      "Pass surplus on through free stores, community fridges, and tool libraries on the Threshold surface.",
    emoji: "🎁",
  },
  {
    resources: ["creativity"],
    title: "Take on creator bounties",
    description:
      "Claim Refrain bounties posted by vendors and patrons — a creator profile isn't a vendor storefront.",
    emoji: "🎨",
  },
  {
    resources: ["audience", "marketing"],
    title: "Partner with vendors",
    description:
      "Apply to vendor-run creator programs and earn through attribution links and promo codes.",
    emoji: "📣",
  },
  {
    resources: ["materials_skills"],
    title: "Teach & share know-how",
    description:
      "Contribute articles to the community knowledge base and host skill shares.",
    emoji: "🌱",
  },
  {
    resources: ["land"],
    title: "Host a community garden",
    description:
      "Offer plots, join garden memberships, and pool harvests with your neighbors.",
    emoji: "🌍",
  },
  {
    resources: ["network", "organization"],
    title: "Pool purchasing power",
    description:
      "Start a buyer network or collective-bargaining group to buy together at better terms.",
    emoji: "🕸️",
  },
]

/**
 * Pathways matching the user's selection, in declaration order, each listed
 * once even when multiple selected resources trigger it.
 */
export function pathwaysForResources(selected: ResourceKey[]): ResourcePathway[] {
  return RESOURCE_PATHWAYS.filter((p) =>
    p.resources.some((r) => selected.includes(r))
  )
}
