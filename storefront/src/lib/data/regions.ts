"use server"

import { medusaFetch } from "../config"
import medusaError from "@/lib/helpers/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { getCacheOptions } from "./cookies"

export const listRegions = async () => {
  const next = {
    ...(await getCacheOptions("regions")),
    revalidate: 3600,
  }

  return medusaFetch<{ regions: HttpTypes.StoreRegion[] }>(`/store/regions?fields=id,name,currency_code`, {
    method: "GET",
    next,
    cache: "force-cache",
  })
    .then(({ regions }) => regions)
    .catch(medusaError)
}

export const retrieveRegion = async (id: string) => {
  const next = {
    ...(await getCacheOptions(["regions", id].join("-"))),
    revalidate: 3600,
  }

  return medusaFetch<{ region: HttpTypes.StoreRegion }>(`/store/regions/${id}`, {
    method: "GET",
    next,
    cache: "force-cache",
  })
    .then(({ region }) => region)
    .catch(medusaError)
}

const regionMap = new Map<string, HttpTypes.StoreRegion>()

export const getRegion = async (countryCode: string) => {
  try {
    if (regionMap.has(countryCode)) {
      return regionMap.get(countryCode)
    }

    const regions = await listRegions()

    if (!regions) {
      return null
    }

    regions.forEach((region) => {
      region.countries?.forEach((c) => {
        regionMap.set(c?.iso_2 ?? "", region)
      })
    })

    // Fallback: return first region when no country match (countries not fetched due to ORM bug)
    const region = countryCode
      ? (regionMap.get(countryCode) ?? regions[0])
      : (regionMap.get("us") ?? regions[0])

    return region
  } catch {
    return null
  }
}
