type FarmProfileLike = {
  year_established?: number | null
  country_code?: string | null
  state?: string | null
}

type HarvestInputLike = {
  year?: number | null
  harvest_date?: string | null
  planted_date?: string | null
  field_name?: string | null
}

export type FarmHarvestConsistencyIssue = {
  code: "HARVEST_YEAR_BEFORE_FARM_ESTABLISHED" | "PLANTED_AFTER_HARVEST"
  message: string
}

export const buildFarmHarvestConsistencyIssues = (
  farmProfile: FarmProfileLike,
  harvest: HarvestInputLike
): FarmHarvestConsistencyIssue[] => {
  const issues: FarmHarvestConsistencyIssue[] = []

  const farmYear = farmProfile.year_established ?? null
  const harvestYear = harvest.year ?? (harvest.harvest_date ? new Date(harvest.harvest_date).getUTCFullYear() : null)

  if (farmYear && harvestYear && harvestYear < farmYear) {
    issues.push({
      code: "HARVEST_YEAR_BEFORE_FARM_ESTABLISHED",
      message: `Harvest year (${harvestYear}) cannot be earlier than farm established year (${farmYear}).`,
    })
  }

  if (harvest.planted_date && harvest.harvest_date) {
    const planted = new Date(harvest.planted_date)
    const harvested = new Date(harvest.harvest_date)
    if (!Number.isNaN(planted.getTime()) && !Number.isNaN(harvested.getTime()) && planted > harvested) {
      issues.push({
        code: "PLANTED_AFTER_HARVEST",
        message: "Planted date must be on or before the harvest date.",
      })
    }
  }

  return issues
}
