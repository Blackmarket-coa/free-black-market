/**
 * Resource quiz → playbook recommendation (server-side mirror of
 * vendor-panel/src/components/playbook/playbook-picker/recommend-from-resources.ts).
 *
 * Pure function. Where `recommend.ts` classifies by social form (size /
 * governance / offering), this scores by *what the vendor has*. Resources
 * can't fully determine social form, so the result is a recommendation the
 * user can override.
 *
 * Keep the scoring table in sync with the vendor-panel mirror and the doc
 * at `docs/PLAYBOOK_SYSTEM.md`.
 */

import type { PlaybookId } from "./recipes/types"
import { PLAYBOOK_IDS } from "./recipes"

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
  | "goods"
  | "creativity"
  | "capital"

export type ResourceRecommendation = {
  playbook: PlaybookId
  reason: string
  alternatives: PlaybookId[]
}

const RESOURCE_SCORES: Record<ResourceKey, Partial<Record<PlaybookId, number>>> = {
  land: { cycle: 3, harvest: 3, grove: 1 },
  time: { service: 3, harvest: 2, grove: 2 },
  transportation: { hub: 3, kitchen: 1 },
  materials_skills: { atelier: 2, stall: 2, service: 2, workshop: 1, creator: 1 },
  equipment: { kitchen: 3, atelier: 2, workshop: 2 },
  audience: { creator: 3, stall: 2, atelier: 1 },
  network: { hub: 3, commons: 2, grove: 1, creator: 1 },
  organization: { commons: 3, workshop: 2, grove: 2, hub: 1 },
  manufacturing: { atelier: 3, workshop: 2, stall: 1 },
  marketing: { creator: 2, stall: 2, hub: 2, atelier: 1 },
  goods: { stall: 3, grove: 2, atelier: 1, hub: 1 },
  creativity: { creator: 3, atelier: 2, stall: 1, workshop: 1 },
  capital: { commons: 3, workshop: 2, cycle: 2, grove: 1, atelier: 1 },
}

// Simpler-playbook tie-break order. Mirrors SIMPLICITY_RANK in recommend.ts.
const SIMPLICITY_RANK: PlaybookId[] = [
  "stall",
  "service",
  "creator",
  "atelier",
  "cycle",
  "kitchen",
  "harvest",
  "grove",
  "workshop",
  "hub",
  "commons",
]

const REASONS: Record<PlaybookId, string> = {
  stall:
    "You said solo and you decide — Stall keeps things simple. You list, you fulfill, you get paid.",
  service:
    "You're offering time on a schedule — Service lets you publish booking windows and apply sliding-scale rates.",
  atelier:
    "A small group, deciding together — Atelier covers an affinity group of makers without imposing formal governance.",
  workshop:
    "You decide in circles — Workshop is a worker co-op with sociocratic governance and patronage refunds.",
  commons:
    "Multiple stakeholders, elected reps — Commons is the multi-stakeholder shape: producers, workers, consumers, supporters.",
  cycle:
    "Subscription or season — Cycle is the CSA shape: time-bounded shares, harvest scheduling, member subscriptions.",
  kitchen:
    "Cooking for the neighborhood — Kitchen handles menus, reservations, pop-ups, and bookable seatings.",
  harvest:
    "A garden you can join — Harvest tracks the season, the volunteer roster, and the shared pool.",
  hub: "Aggregating other vendors — Hub is the federation shape: many vendors, one storefront, governance shared.",
  grove:
    "Mutual-aid posture — Grove pairs sliding-scale pricing with co-op governance and a volunteer-rich front desk.",
  creator:
    "An audience you can sell to — Creator gives you memberships, digital drops, and a shows calendar.",
}

const rankSimplicity = (id: PlaybookId): number => {
  const rank = SIMPLICITY_RANK.indexOf(id)
  return rank === -1 ? SIMPLICITY_RANK.length : rank
}

export const recommendPlaybookFromResources = (
  selected: ResourceKey[]
): ResourceRecommendation => {
  const scores = new Map<PlaybookId, number>()
  for (const id of PLAYBOOK_IDS) {
    scores.set(id, 0)
  }
  for (const key of selected) {
    const boosts = RESOURCE_SCORES[key]
    if (!boosts) continue
    for (const [id, pts] of Object.entries(boosts) as [PlaybookId, number][]) {
      scores.set(id, (scores.get(id) ?? 0) + pts)
    }
  }

  const ranked = PLAYBOOK_IDS.slice().sort((a, b) => {
    const diff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
    if (diff !== 0) return diff
    return rankSimplicity(a) - rankSimplicity(b)
  })

  const playbook = ranked[0]
  return {
    playbook,
    reason: REASONS[playbook],
    alternatives: ranked.slice(1, 4),
  }
}
