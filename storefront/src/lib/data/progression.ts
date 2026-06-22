"use server"

import { cookies as nextCookies } from "next/headers"
import { medusaFetch } from "../config"
import { getAuthHeaders } from "./cookies"

/** The role a user is currently "playing". Mirrors the backend Stance enum. */
export type Stance =
  | "producer"
  | "consumer"
  | "investor"
  | "coalition"
  | "creator"

export type RoleTrack = {
  role: Stance
  xp: number
  level: number
  xpIntoLevel: number
  xpForNextLevel: number
  pct: number
}

export type EarnedTitle = {
  slug: string
  role: Stance
  name: string
  description: string
  icon: string
  color: string
  earnedAt?: string
}

export type CharacterSheet = {
  customerId: string
  activeStance: Stance
  totalXp: number
  /** Spendable XP balance (separate from lifetime status `totalXp`). */
  spendableXp: number
  tracks: RoleTrack[]
  stats: {
    foodProducedCents: number
    ordersCompleted: number
    capitalDeployedCents: number
    mutualAidContributions: number
    trustScore: number
    karma: number
    timeCredits: number
  }
  titles: EarnedTitle[]
  lastRecomputedAt?: string | null
}

const STANCE_COOKIE = "fbm_stance"

/**
 * Fetch the authenticated customer's character sheet. Returns null when the
 * visitor is logged out (mirrors the coalition-credits data-lib pattern).
 */
export const getCharacterSheet = async (): Promise<CharacterSheet | null> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return null

  try {
    const { character } = await medusaFetch<{ character: CharacterSheet }>(
      "/store/character",
      { method: "GET", headers: authHeaders, cache: "no-store" }
    )
    return character
  } catch {
    return null
  }
}

/**
 * Set the active stance on the backend and mirror it into a readable cookie so
 * SSR can theme the next render instantly.
 */
export const setStance = async (
  stance: Stance
): Promise<CharacterSheet | null> => {
  const authHeaders = await getAuthHeaders()

  // Always set the cookie — themes the UI even before/without auth.
  const cookies = await nextCookies()
  cookies.set(STANCE_COOKIE, stance, {
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  })

  if (!authHeaders) return null

  try {
    const { character } = await medusaFetch<{ character: CharacterSheet }>(
      "/store/character/stance",
      {
        method: "POST",
        headers: authHeaders,
        body: { stance },
        cache: "no-store",
      }
    )
    return character
  } catch {
    return null
  }
}

/** Read the stance cookie for SSR theming (defaults to consumer). */
export const getStanceCookie = async (): Promise<Stance> => {
  const cookies = await nextCookies()
  const value = cookies.get(STANCE_COOKIE)?.value
  const valid: Stance[] = [
    "producer",
    "consumer",
    "investor",
    "coalition",
    "creator",
  ]
  return valid.includes(value as Stance) ? (value as Stance) : "consumer"
}

// ─── XP economy: spendable balance + reward redemption ─────────────────────

export type XpRewardKind = "entitlement" | "digital_download"

export type XpReward = {
  key: string
  name: string
  description: string
  xpCost: number
  kind: XpRewardKind
  featureKey: string
  entitlementKind: string
  durationDays?: number
  icon?: string
  /** Whether the current balance can afford this reward. */
  affordable: boolean
}

export type XpRedemption = {
  id: string
  reward_key: string
  reward_name: string
  reward_kind: XpRewardKind
  xp_cost: number
  status: "pending" | "fulfilled" | "refunded"
  feature_key?: string | null
  entitlement_id?: string | null
  created_at?: string
  fulfilled_at?: string | null
}

export type XpRewardsResponse = {
  balance: number
  rewards: XpReward[]
  history: XpRedemption[]
}

/**
 * Fetch the spendable-XP balance, reward catalog, and redemption history.
 * Returns null when logged out.
 */
export const getXpRewards = async (): Promise<XpRewardsResponse | null> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return null

  try {
    return await medusaFetch<XpRewardsResponse>("/store/xp/rewards", {
      method: "GET",
      headers: authHeaders,
      cache: "no-store",
    })
  } catch {
    return null
  }
}

export type RedeemResult =
  | { ok: true; balance: number; redemption: XpRedemption }
  | { ok: false; error: string; required?: number; available?: number }

/** Redeem spendable XP for a catalog reward. */
export const redeemXpReward = async (
  rewardKey: string
): Promise<RedeemResult> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return { ok: false, error: "Authentication required" }

  try {
    const data = await medusaFetch<{
      success: boolean
      balance: number
      redemption: XpRedemption
    }>("/store/xp/redeem", {
      method: "POST",
      headers: authHeaders,
      body: { reward_key: rewardKey },
      cache: "no-store",
    })
    return { ok: true, balance: data.balance, redemption: data.redemption }
  } catch (e) {
    const err = e as { message?: string; status?: number; required?: number; available?: number }
    return {
      ok: false,
      error: err?.message ?? "Failed to redeem reward",
      required: err?.required,
      available: err?.available,
    }
  }
}
