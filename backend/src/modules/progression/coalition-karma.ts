/**
 * Coalition KARMA: the deltas Blackout coalition activity earns on the one
 * ecosystem ladder.
 *
 * Two constraints shape every number here, and both are load-bearing:
 *
 *  1. **Reputation and capital stay structurally separate.** No delta scales
 *     with money raised, and no coalition award unlocks a commission rate, a
 *     price, or access to an offering. `thresholds.ts` records why: "Reputation
 *     and capital are required to stay structurally separate, and preferential
 *     access to an offering conditioned on prior investment is a distribution
 *     practice, not a loyalty perk." A flat award for completing a drive is a
 *     contribution record; an award proportional to the dollars is a rebate,
 *     which is the pattern flagged for legal review. So: flat, always.
 *  2. **One ladder, one write path.** These deltas ride
 *     `ProgressionModuleService.recordXpEvent` on the COALITION stance, which
 *     the 15-minute mirror copies into `karma_event`. There is no second
 *     reputation store and no Blackout-only stat.
 */
import { Stance } from "./stance"

export type CoalitionKarmaEventType =
  | "coalition_founded"
  | "member_joined"
  | "drive_completed"
  | "drive_contributed"
  | "mutual_aid_fulfilled"
  | "aid_raised"
  | "project_delivered"
  | "quest_completed"

/**
 * Flat deltas, deliberately small and un-scaled. A drive that raises $50,000
 * earns exactly what a drive that raises $500 earns, because the reputation
 * records that the group did the thing — not how much money moved.
 */
export const COALITION_KARMA_DELTAS: Record<CoalitionKarmaEventType, number> = {
  coalition_founded: 10,
  member_joined: 2,
  drive_completed: 25,
  drive_contributed: 5,
  mutual_aid_fulfilled: 15,
  aid_raised: 3,
  project_delivered: 20,
  quest_completed: 30,
}

export const COALITION_KARMA_DESCRIPTIONS: Record<CoalitionKarmaEventType, string> = {
  coalition_founded: "Founded a coalition",
  member_joined: "Joined a coalition",
  drive_completed: "Completed a coalition drive",
  drive_contributed: "Contributed to a coalition drive",
  mutual_aid_fulfilled: "Fulfilled a mutual-aid request through a coalition",
  aid_raised: "Raised a neighbour's request to a coalition",
  project_delivered: "Delivered a coalition project",
  quest_completed: "Completed a coalition quest",
}

export function isCoalitionKarmaEventType(value: unknown): value is CoalitionKarmaEventType {
  return typeof value === "string" && value in COALITION_KARMA_DELTAS
}

/** The stance coalition activity moves. Never PRODUCER — this is not selling. */
export const COALITION_KARMA_STANCE = Stance.COALITION

/** Namespaced reason slug, matching the grower/wellness vertical convention. */
export function coalitionKarmaReason(eventType: CoalitionKarmaEventType): string {
  return `coalition:${eventType}`
}

/** The source module registered in `KARMA_SOURCE_MODULES` for these writes. */
export const COALITION_KARMA_SOURCE_MODULE = "blackout_coalition"

/**
 * Deterministic replay key. Blackout supplies a stable reference (a campaign
 * id, a membership id) and the event type qualifies it, so the same logical
 * event retried never awards twice.
 */
export function coalitionKarmaSourceId(
  eventType: CoalitionKarmaEventType,
  referenceId: string
): string {
  return `${eventType}:${referenceId}`
}
