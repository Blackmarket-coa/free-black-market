import { summarizeSpeciesDemand } from "../plant-demand"

describe("plant-demand: summarizeSpeciesDemand", () => {
  const post = {
    id: "dp_1",
    title: "Species demand: Jaboticaba",
    committed_quantity: 0,
    target_quantity: 50,
    specs: {
      species_name: "Jaboticaba",
      zone_counts: { "7": 3, "9": 1, "10": 2 },
      max_prices: [10, 20],
    },
  }

  it("aggregates active participants, ignoring withdrawn", () => {
    const summary = summarizeSpeciesDemand(post, [
      { status: "COMMITTED", quantity_committed: 5 },
      { status: "COMMITTED", quantity_committed: 10 },
      { status: "WITHDRAWN", quantity_committed: 99 },
    ])
    expect(summary.total_expressions).toBe(2)
    expect(summary.total_units_requested).toBe(15)
    expect(summary.avg_max_price).toBe(15)
    expect(summary.species_name).toBe("Jaboticaba")
  })

  it("returns the top 3 zones by count, descending", () => {
    const summary = summarizeSpeciesDemand(post, [])
    expect(summary.top_zones).toEqual([7, 10, 9])
  })

  it("flags the production threshold once committed >= target", () => {
    expect(summarizeSpeciesDemand(post, []).production_threshold_met).toBe(false)
    const met = summarizeSpeciesDemand({ ...post, committed_quantity: 50 }, [])
    expect(met.production_threshold_met).toBe(true)
  })

  it("tolerates missing specs", () => {
    const summary = summarizeSpeciesDemand({ id: "dp_2", title: "Lychee", specs: null }, [])
    expect(summary.species_name).toBe("Lychee")
    expect(summary.avg_max_price).toBe(0)
    expect(summary.top_zones).toEqual([])
  })
})
