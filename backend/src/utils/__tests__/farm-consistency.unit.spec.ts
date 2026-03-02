import { buildFarmHarvestConsistencyIssues } from "../../api/vendor/farm/consistency"

describe("farm/harvest consistency", () => {
  it("flags harvest year before farm establishment", () => {
    const issues = buildFarmHarvestConsistencyIssues(
      { year_established: 2020 },
      { year: 2019 }
    )
    expect(issues.some((i) => i.code === "HARVEST_YEAR_BEFORE_FARM_ESTABLISHED")).toBe(true)
  })

  it("flags planted date after harvest", () => {
    const issues = buildFarmHarvestConsistencyIssues(
      { year_established: 2020 },
      { planted_date: "2024-05-10", harvest_date: "2024-05-01" }
    )
    expect(issues.some((i) => i.code === "PLANTED_AFTER_HARVEST")).toBe(true)
  })
})
