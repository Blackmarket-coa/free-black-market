"use server"

import { medusaFetch } from "../config"
import { getAuthHeaders } from "./cookies"

export type CollectiveGoal = {
  id: string
  scope_type: "TREASURY" | "QUORUM" | "FOOD_FOREST" | "CUSTOM"
  scope_id?: string | null
  den_id?: string | null
  title: string
  description?: string | null
  target_value: number
  current_value: number
  unit: string
  status: "ACTIVE" | "COMPLETE"
  opt_in_leaderboard: boolean
}

export type CollectiveQuest = {
  id: string
  den_id?: string | null
  goal_id?: string | null
  title: string
  description?: string | null
  boss_hp: number
  hp_remaining: number
  reward_pool_xp: number
  status: "ACTIVE" | "COMPLETE" | "EXPIRED"
}

export type LeaderboardEntry = {
  customer_id: string
  contribution: number
  band: "seedling" | "sprout" | "grove"
}

/** Shared-goal thermometers for a den (current_value snapshotted server-side). */
export const getCollectiveGoals = async (
  denId?: string
): Promise<CollectiveGoal[]> => {
  try {
    const qs = new URLSearchParams({ refresh: "true" })
    if (denId) qs.set("den_id", denId)
    const { goals } = await medusaFetch<{ goals: CollectiveGoal[] }>(
      `/store/collective-quest/goals?${qs.toString()}`,
      { method: "GET", cache: "no-store" }
    )
    return goals ?? []
  } catch {
    return []
  }
}

/** Group "boss" quests for a den (defaults to ACTIVE). */
export const getCollectiveQuests = async (
  denId?: string,
  status?: CollectiveQuest["status"]
): Promise<CollectiveQuest[]> => {
  try {
    const qs = new URLSearchParams()
    if (denId) qs.set("den_id", denId)
    if (status) qs.set("status", status)
    const { quests } = await medusaFetch<{ quests: CollectiveQuest[] }>(
      `/store/collective-quest/quests?${qs.toString()}`,
      { method: "GET", cache: "no-store" }
    )
    return quests ?? []
  } catch {
    return []
  }
}

/** Opt-in, relative-to-self den activity view (no competitive rank). */
export const getDenLeaderboard = async (
  denId: string
): Promise<LeaderboardEntry[]> => {
  try {
    const { entries } = await medusaFetch<{ entries: LeaderboardEntry[] }>(
      `/store/collective-quest/leaderboard?den_id=${encodeURIComponent(denId)}`,
      { method: "GET", cache: "no-store" }
    )
    return entries ?? []
  } catch {
    return []
  }
}

/** Pledge effort toward a quest boss (recorded unverified — see ADR-0004). */
export const contributeToQuest = async (
  questId: string,
  hpReduction: number,
  leaderboardOptIn: boolean
): Promise<{ ok: boolean }> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return { ok: false }
  try {
    await medusaFetch(
      `/store/collective-quest/quests/${questId}/contribute`,
      {
        method: "POST",
        headers: authHeaders,
        body: { hp_reduction: hpReduction, leaderboard_opt_in: leaderboardOptIn },
      }
    )
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
