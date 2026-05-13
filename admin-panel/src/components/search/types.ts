import type { SEARCH_AREAS } from "@components/search/constants"

export type SearchArea = (typeof SEARCH_AREAS)[number]

export type DynamicSearchResultItem = {
  id: string
  title: string
  subtitle?: string
  to: string
  thumbnail?: string
  value: string
}

export type DynamicSearchResult = {
  area: SearchArea
  title: string
  hasMore: boolean
  count: number
  items: DynamicSearchResultItem[]
}
