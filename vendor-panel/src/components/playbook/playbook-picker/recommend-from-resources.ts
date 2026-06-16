/**
 * Resource quiz → playbook recommendation (browser-side mirror of
 * `backend/src/modules/playbook/recommend-from-resources.ts`).
 *
 * Where the 3-question picker (`recommend.ts`) classifies a vendor by
 * social form (size / governance / offering), this scorer classifies by
 * *what the vendor has* — the resources they bring. Resources can't fully
 * determine social form, so the result is a recommendation the user can
 * override on the reveal step.
 *
 * Keep this file in sync with the backend mirror and the scoring table
 * documented in `docs/PLAYBOOK_SYSTEM.md`. If you update one, update the
 * other.
 */

import {
  ALL_PLAYBOOKS,
  PLAYBOOK_DISPLAY_NAMES,
  SIMPLICITY_RANK,
  reasonFor,
  type PlaybookId,
  type Recommendation,
} from "./recommend"

export type ResourceKey =
  | "land"
  | "time"
  | "transportation"
  | "materials_skills"
  | "equipment"
  | "audience"
  | "network"
  | "organization"
  | "manufacturing"
  | "marketing"

export type ResourceOption = {
  value: ResourceKey
  label: string
  description: string
  emoji?: string
}

/**
 * Resource options grouped into themed quiz steps. The quiz renders one
 * multi-select step per group; the user may pick any number (including
 * none) in each.
 */
export const RESOURCE_GROUPS: { key: string; title: string; subtitle: string; options: ResourceOption[] }[] = [
  {
    key: "assets",
    title: "What do you have to work with?",
    subtitle: "Pick anything you can put to use — choose all that apply.",
    options: [
      { value: "land", label: "Land or space", description: "Land, plots, or growing / kitchen space", emoji: "🌍" },
      { value: "equipment", label: "Equipment & tools", description: "Machines, kitchen gear, or workshop tools", emoji: "🛠️" },
      { value: "transportation", label: "Transportation", description: "A vehicle for pickup, delivery, or hauling", emoji: "🚚" },
      { value: "manufacturing", label: "Manufacturing", description: "Capacity to make or produce goods", emoji: "🏭" },
    ],
  },
  {
    key: "people",
    title: "Who's behind it?",
    subtitle: "The people and community you can draw on.",
    options: [
      { value: "time", label: "Time & labor", description: "Hours to work, volunteer, or help out", emoji: "⏰" },
      { value: "organization", label: "An organization", description: "A co-op, nonprofit, or formal group", emoji: "🏛️" },
      { value: "network", label: "A network", description: "Connections to other vendors or growers", emoji: "🕸️" },
      { value: "audience", label: "An audience", description: "Followers or customers who already know you", emoji: "📣" },
    ],
  },
  {
    key: "skills",
    title: "What can you offer?",
    subtitle: "Know-how, materials, and ways to reach people.",
    options: [
      { value: "materials_skills", label: "Materials & skills", description: "Seeds, supplies, or know-how to teach", emoji: "🌱" },
      { value: "marketing", label: "Marketing reach", description: "Channels or opportunities to promote", emoji: "📈" },
    ],
  },
]

export const RESOURCE_OPTIONS: ResourceOption[] = RESOURCE_GROUPS.flatMap((g) => g.options)

/**
 * Scoring table: each resource adds points to the playbooks it suits.
 * The recommendation is the highest-scoring playbook; ties resolve to the
 * simpler playbook (the same SIMPLICITY_RANK the 3-question picker uses).
 */
const RESOURCE_SCORES: Record<ResourceKey, Partial<Record<PlaybookId, number>>> = {
  land: { cycle: 3, harvest: 3, grove: 1 },
  time: { service: 3, harvest: 2, grove: 2 },
  transportation: { hub: 3, kitchen: 1 },
  materials_skills: { atelier: 2, stall: 2, service: 2, workshop: 1 },
  equipment: { kitchen: 3, atelier: 2, workshop: 2 },
  audience: { stall: 2, atelier: 1 },
  network: { hub: 3, commons: 2, grove: 1 },
  organization: { commons: 3, workshop: 2, grove: 2, hub: 1 },
  manufacturing: { atelier: 3, workshop: 2, stall: 1 },
  marketing: { stall: 2, hub: 2, atelier: 1 },
}

const rankSimplicity = (id: PlaybookId): number => {
  const rank = SIMPLICITY_RANK.indexOf(id)
  return rank === -1 ? SIMPLICITY_RANK.length : rank
}

/**
 * Short customer-facing blurb per playbook, surfaced in the override grid
 * so every option is legible. Mirrors the `social_form` copy on the
 * backend recipes (`backend/src/modules/playbook/recipes/*.ts`).
 */
export const PLAYBOOK_BLURBS: Record<PlaybookId, string> = {
  stall: "Solo seller — you list, you fulfill, you get paid.",
  atelier: "A small affinity group of makers, 2–12, deciding together.",
  grove: "Mutual-aid co-op with sliding-scale pricing and volunteers.",
  workshop: "Worker co-op with sociocratic circles and patronage refunds.",
  commons: "Multi-stakeholder co-op: producers, workers, and consumers.",
  cycle: "CSA / order-cycle farm with seasonal shares and subscriptions.",
  kitchen: "Restaurant, commissary, or shared kitchen with menus and pickup.",
  harvest: "Community garden or collective harvest with a shared pool.",
  hub: "Federation hub that aggregates many vendors under one storefront.",
  service: "Time-bank or sliding-scale practitioner offering bookable time.",
}

export function recommendPlaybookFromResources(selected: ResourceKey[]): Recommendation {
  const scores = new Map<PlaybookId, number>()
  for (const id of ALL_PLAYBOOKS) {
    scores.set(id, 0)
  }
  for (const key of selected) {
    const boosts = RESOURCE_SCORES[key]
    if (!boosts) continue
    for (const [id, pts] of Object.entries(boosts) as [PlaybookId, number][]) {
      scores.set(id, (scores.get(id) ?? 0) + pts)
    }
  }

  const ranked = ALL_PLAYBOOKS.slice().sort((a, b) => {
    const diff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
    if (diff !== 0) return diff
    return rankSimplicity(a) - rankSimplicity(b)
  })

  const playbook = ranked[0]
  return {
    playbook,
    reason: reasonFor(playbook),
    alternatives: ranked.slice(1, 4),
  }
}

export { ALL_PLAYBOOKS, PLAYBOOK_DISPLAY_NAMES }
