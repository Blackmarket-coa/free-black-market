/**
 * 3-question vendor picker → playbook recommendation.
 *
 * Pure function. Same input always produces the same output. The decision
 * tree is in `docs/PLAYBOOK_SYSTEM.md` and the answer/result types here
 * are the canonical machine-readable form.
 *
 * Resolution policy on ties: prefer the simpler playbook (Stall over
 * Atelier; Atelier over Workshop). The principle is "don't conscript users
 * into governance they didn't ask for".
 */

import type { PlaybookId } from "./recipes/types"

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
  playbook: PlaybookId
  reason: string
  alternatives: PlaybookId[]
}

const SIZE_SETS: Record<SizeAnswer, PlaybookId[]> = {
  solo: ["stall", "service"],
  small: ["atelier", "workshop", "grove", "kitchen", "harvest", "cycle", "service"],
  medium: ["workshop", "commons", "grove", "kitchen", "harvest", "cycle", "hub"],
  federation: ["commons", "hub", "cycle"],
}

const GOVERNANCE_SETS: Record<GovernanceAnswer, PlaybookId[]> = {
  i_decide: ["stall", "atelier"],
  informal_agreement: ["atelier", "grove", "kitchen", "harvest", "cycle"],
  // `circles` points at sociocratic governance — Workshop's signature.
  // Grove and Commons run on informal agreement / elected reps respectively.
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

/**
 * Simpler-playbook tie-break order. Lower index wins.
 *
 * "Simpler" means less governance overhead. A user who could plausibly be
 * a Stall or an Atelier becomes a Stall by default; they can override.
 */
const SIMPLICITY_RANK: PlaybookId[] = [
  "stall",
  "service",
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

/**
 * Reason copy for the recommendation card. The user sees this with the
 * recommended playbook plus a "see other options" link to override.
 */
const reasonFor = (
  playbook: PlaybookId,
  _answers: PickerAnswers
): string => {
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
  }
}

/**
 * Recommend a playbook from picker answers.
 *
 * @returns the recommended playbook, a reason string for the reveal card,
 * and a list of alternatives the user can switch to via "see other options".
 */
export const recommendPlaybook = (answers: PickerAnswers): Recommendation => {
  const candidates = intersect(
    intersect(SIZE_SETS[answers.size], GOVERNANCE_SETS[answers.governance]),
    OFFERING_SETS[answers.offering]
  )

  // Fall back: if the intersection is empty, expand by dropping the
  // strictest constraint (governance) and try again. This ensures every
  // answer combination produces some recommendation rather than a dead
  // end. We mark the result as "loose match" via alternatives.
  const finalCandidates =
    candidates.length > 0
      ? candidates
      : intersect(SIZE_SETS[answers.size], OFFERING_SETS[answers.offering])

  // Last resort: pick from offering alone.
  const ranked = (
    finalCandidates.length > 0 ? finalCandidates : OFFERING_SETS[answers.offering]
  )
    .slice()
    .sort((a, b) => rankSimplicity(a) - rankSimplicity(b))

  const playbook = ranked[0]
  return {
    playbook,
    reason: reasonFor(playbook, answers),
    alternatives: ranked.slice(1, 4),
  }
}
