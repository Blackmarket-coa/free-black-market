"use server"

import { medusaFetch } from "../config"

export type QuestCatalogEntry = {
  key: string
  category: string
  title: string
  outcome: string
  type: "individual" | "collective"
  gatekeeper: string
  gatekeeper_links: Array<{ label: string; url: string }>
  has_packet: boolean
  stages: Array<{ key: string; label: string }>
  requirement_counts: Record<string, number>
}

export type QuestCatalog = {
  quests: QuestCatalogEntry[]
  categories: string[]
  access: {
    plans: Array<{
      code: string
      display_name: string
      price_amount: number
      currency_code: string
      interval: string
    }>
    addons: Array<{
      code: string
      display_name: string
      price_amount: number
      currency_code: string
      duration_days: number
    }>
  }
}

/**
 * The published vendor quest catalog. Backs `/quests`.
 *
 * Throws on failure: the page is nothing but this data, and an empty catalog
 * would misrepresent the platform's most differentiated feature as absent.
 */
export async function getQuestCatalog(): Promise<QuestCatalog> {
  return medusaFetch<QuestCatalog>("/store/quest-catalog", {
    method: "GET",
    next: { revalidate: 3600 },
  })
}
