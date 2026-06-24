import handler from "../progression-volunteer-verified"
import { Stance } from "../../modules/progression/stance"

const makeContainer = (progression: Record<string, jest.Mock>) => ({
  resolve: (token: string) => {
    if (token === "query") return { graph: jest.fn() }
    if (token === "progressionModuleService") return progression
    return {}
  },
})

const run = (data: Record<string, unknown>, progression: Record<string, jest.Mock>) =>
  handler({ event: { data }, container: makeContainer(progression) } as any)

describe("progression-volunteer-verified subscriber", () => {
  it("awards COALITION XP through the attestation path, crediting the verifier", async () => {
    const progression = {
      recordAttestedXpEvent: jest.fn().mockResolvedValue(undefined),
      recomputeAggregates: jest.fn().mockResolvedValue(undefined),
    }
    await run(
      { log_id: "log_1", customer_id: "cus_1", verified_by_id: "cus_admin", hours: 3, credits: 30 },
      progression
    )
    expect(progression.recordAttestedXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "cus_1", role: Stance.COALITION, amount: 30, reason: "volunteer-verified" }),
      { attesterId: "cus_admin" }
    )
  })

  it("no-ops without a subject customer id", async () => {
    const progression = { recordAttestedXpEvent: jest.fn(), recomputeAggregates: jest.fn() }
    await run({ log_id: "log_2", verified_by_id: "cus_admin", hours: 1 }, progression)
    expect(progression.recordAttestedXpEvent).not.toHaveBeenCalled()
  })

  it("swallows errors (incl. self-attestation) so XP never breaks verification", async () => {
    const progression = {
      recordAttestedXpEvent: jest.fn().mockRejectedValue(new Error("self-attestation")),
      recomputeAggregates: jest.fn(),
    }
    await expect(
      run({ log_id: "log_3", customer_id: "cus_1", verified_by_id: "cus_1", hours: 2 }, progression)
    ).resolves.toBeUndefined()
  })
})
