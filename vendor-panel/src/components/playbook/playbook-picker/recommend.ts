/**
 * 3-question vendor picker → playbook recommendation (browser-side
 * mirror of `backend/src/modules/playbook/recommend.ts`).
 *
 * Keep this file in sync with the backend version. Both share the same
 * SIZE_SETS / GOVERNANCE_SETS / OFFERING_SETS tables and the same
 * simplicity tie-break ordering. The mirror exists so the picker UI can
 * show the recommendation reveal without a network round-trip.
 *
 * If you update one, update the other and the doc at
 * `docs/PLAYBOOK_SYSTEM.md`.
 */

import type { Playbook } from "../../../providers/playbook-provider"

export type SizeAnswer = "solo" | "small" | "medium" | "federation"
export type GovernanceAnswer =
  | "i_decide"
  | "informal_agreement"
  | "circles"
  | "elected_reps"
  | "federation_council"
export type OfferingAnswer =
  | "make_or_grow"
  | "services"
  | "subscription_or_season"
  | "kitchen_food"
  | "harvest_pool"
  | "aggregator"

export type PickerAnswers = {
  size: SizeAnswer
  governance: GovernanceAnswer
  offering: OfferingAnswer
}

export type Recommendation = {
  playbook: Exclude<Playbook, "default">
  reason: string
  alternatives: Exclude<Playbook, "default">[]
}

export type PlaybookId = Exclude<Playbook, "default">

const SIZE_SETS: Record<SizeAnswer, PlaybookId[]> = {
  solo: ["stall", "service"],
  small: ["atelier", "workshop", "grove", "kitchen", "harvest", "cycle", "service"],
  medium: ["workshop", "commons", "grove", "kitchen", "harvest", "cycle", "hub"],
  federation: ["commons", "hub", "cycle"],
}

const GOVERNANCE_SETS: Record<GovernanceAnswer, PlaybookId[]> = {
  i_decide: ["stall", "atelier"],
  informal_agreement: ["atelier", "grove", "kitchen", "harvest", "cycle"],
  circles: ["workshop"],
  elected_reps: ["commons", "hub"],
  federation_council: ["hub", "commons"],
}

const OFFERING_SETS: Record<OfferingAnswer, PlaybookId[]> = {
  make_or_grow: ["stall", "atelier", "workshop", "commons", "cycle", "grove", "harvest"],
  services: ["service"],
  subscription_or_season: ["cycle", "service", "harvest"],
  kitchen_food: ["kitchen"],
  harvest_pool: ["harvest"],
  aggregator: ["hub"],
}

export const SIMPLICITY_RANK: PlaybookId[] = [
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

const intersect = (a: PlaybookId[], b: PlaybookId[]): PlaybookId[] =>
  a.filter((x) => b.includes(x))

const rankSimplicity = (id: PlaybookId): number => {
  const rank = SIMPLICITY_RANK.indexOf(id)
  return rank === -1 ? SIMPLICITY_RANK.length : rank
}

export const reasonFor = (playbook: PlaybookId): string => {
  switch (playbook) {
    case "stall":
      return "You said solo and you decide — Stall keeps things simple. You list, you fulfill, you get paid."
    case "service":
      return "You're offering time on a schedule — Service lets you publish booking windows and apply sliding-scale rates."
    case "atelier":
      return "A small group, deciding together — Atelier covers an affinity group of makers without imposing formal governance."
    case "workshop":
      return "You decide in circles — Workshop is a worker co-op with sociocratic governance and patronage refunds."
    case "commons":
      return "Multiple stakeholders, elected reps — Commons is the multi-stakeholder shape: producers, workers, consumers, supporters."
    case "cycle":
      return "Subscription or season — Cycle is the CSA shape: time-bounded shares, harvest scheduling, member subscriptions."
    case "kitchen":
      return "Cooking for the neighborhood — Kitchen handles menus, reservations, pop-ups, and bookable seatings."
    case "harvest":
      return "A garden you can join — Harvest tracks the season, the volunteer roster, and the shared pool."
    case "hub":
      return "Aggregating other vendors — Hub is the federation shape: many vendors, one storefront, governance shared."
    case "grove":
      return "Mutual-aid posture — Grove pairs sliding-scale pricing with co-op governance and a volunteer-rich front desk."
    case "creator":
      return "An audience you can sell to — Creator gives you memberships, digital drops, and a shows calendar."
  }
}

export const recommendPlaybook = (answers: PickerAnswers): Recommendation => {
  const candidates = intersect(
    intersect(SIZE_SETS[answers.size], GOVERNANCE_SETS[answers.governance]),
    OFFERING_SETS[answers.offering]
  )

  const finalCandidates =
    candidates.length > 0
      ? candidates
      : intersect(SIZE_SETS[answers.size], OFFERING_SETS[answers.offering])

  const ranked = (
    finalCandidates.length > 0 ? finalCandidates : OFFERING_SETS[answers.offering]
  )
    .slice()
    .sort((a, b) => rankSimplicity(a) - rankSimplicity(b))

  const playbook = ranked[0]
  return {
    playbook,
    reason: reasonFor(playbook),
    alternatives: ranked.slice(1, 4),
  }
}

export const ALL_PLAYBOOKS: PlaybookId[] = [
  "stall",
  "atelier",
  "grove",
  "workshop",
  "commons",
  "cycle",
  "kitchen",
  "harvest",
  "hub",
  "service",
  "creator",
]

export const PLAYBOOK_DISPLAY_NAMES: Record<PlaybookId, string> = {
  stall: "Stall",
  atelier: "Atelier",
  grove: "Grove",
  workshop: "Workshop",
  commons: "Commons",
  cycle: "Cycle",
  kitchen: "Kitchen",
  harvest: "Harvest",
  hub: "Hub",
  service: "Service",
  creator: "Creator",
}
