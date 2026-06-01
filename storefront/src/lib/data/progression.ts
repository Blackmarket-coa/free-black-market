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
