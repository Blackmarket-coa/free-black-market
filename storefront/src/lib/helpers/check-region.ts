import { listRegions } from "../data/regions"

export const checkRegion = async (locale: string): Promise<boolean> => {
  try {
    const regions = await listRegions()
    if (!regions?.length) return false

    const countries = regions
      .flatMap((r) => r.countries?.map((c) => c.iso_2) ?? [])
      .filter(Boolean)

    // When no countries are assigned to any region (e.g. a freshly seeded
    // region), accept any locale as long as at least one region exists. This
    // keeps locale routing working instead of redirect-looping `/ -> /us -> /`.
    if (countries.length === 0) return true

    return countries.includes(locale)
  } catch {
    return false
  }
}
