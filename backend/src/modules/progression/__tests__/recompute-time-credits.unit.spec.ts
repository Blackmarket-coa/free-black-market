import ProgressionModuleService from "../service"

/**
 * `recomputeAggregates` snapshots the member's earned time credits onto the
 * character sheet. Until 2026-09-06 it queried a `time_credit` entity and a
 * `credit_amount` field, neither of which exists — the `volunteer` module's
 * model is `garden_time_credit` with an `amount` — so the swallowed error
 * left the storefront's "Time Credits" stat permanently 0
 * (`docs/CDFI_COOP_ROADMAP.md` §1a). Real prototype, fake `this`.
 */

type GraphArgs = { entity: string; fields: string[]; filters: Record<string, unknown> }

type Patch = Record<string, unknown>

const makeFake = () => {
  const fake = {
    getOrCreateCharacterSheet: jest.fn(async () => ({ id: "cs_1", customer_id: "cus_1" })),
    updateCharacterSheets: jest.fn<Promise<void>, [Patch]>(async () => undefined),
  }
  return fake as unknown as ProgressionModuleService & typeof fake
}

const makeQuery = (credits: Array<{ amount: number | string; status: string }>) => ({
  graph: jest.fn(async ({ entity }: GraphArgs) => {
    if (entity === "garden_time_credit") return { data: credits }
    return { data: [] }
  }),
})

describe("recomputeAggregates — time credits", () => {
  it("reads garden_time_credit by customer and sums only earned credits", async () => {
    const fake = makeFake()
    const query = makeQuery([
      { amount: 15, status: "available" },
      { amount: "30", status: "redeemed" },
      { amount: 45, status: "pending" },
      { amount: 60, status: "expired" },
      { amount: 75, status: "cancelled" },
    ])

    await ProgressionModuleService.prototype.recomputeAggregates.call(fake, "cus_1", query)

    const call = query.graph.mock.calls.find(([args]) => args.entity === "garden_time_credit")?.[0]
    expect(call).toBeDefined()
    expect(call?.fields).toEqual(expect.arrayContaining(["amount", "status"]))
    expect(call?.filters).toEqual({ customer_id: "cus_1" })

    const [patch] = fake.updateCharacterSheets.mock.calls[0]
    expect(patch.time_credits).toBe(45)
    expect(patch.mutual_aid_contributions).toBe(2)
  })

  it("leaves the snapshot untouched when the volunteer module is absent", async () => {
    const fake = makeFake()
    const query = {
      graph: jest.fn(async ({ entity }: GraphArgs) => {
        if (entity === "garden_time_credit") throw new Error("entity not registered")
        return { data: [] }
      }),
    }

    await ProgressionModuleService.prototype.recomputeAggregates.call(fake, "cus_1", query)

    const [patch] = fake.updateCharacterSheets.mock.calls[0]
    expect(patch).not.toHaveProperty("time_credits")
    expect(patch).not.toHaveProperty("mutual_aid_contributions")
  })
})
