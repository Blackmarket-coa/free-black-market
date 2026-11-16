import { MedusaError } from "@medusajs/framework/utils"
import { isBallotChoice, isDuplicateBallotError } from "../service"

/**
 * `castBallot` answers "already voted" only for the unique ballot index, and
 * only in the shape that index's refusal actually reaches it: Medusa's
 * `dbErrorMapper` rethrows the driver's 23505 as INVALID_DATA naming the
 * table and the conflicting key (seen on Postgres in
 * integration-tests/http/store-proposal-votes-race.spec.ts). Anything else
 * must still surface as the error it is.
 */
describe("isDuplicateBallotError", () => {
  it("matches the unique ballot index as Medusa reports it, and a bare 23505 naming that index", () => {
    expect(
      isDuplicateBallotError(
        new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Garden vote with proposal_id: 01M7GMCW4MD7BQG3WF32VH0DKW, customer_id: cus_01M7GMCV60ZGM4B8MRN7JEZGQ1, already exists."
        )
      )
    ).toBe(true)
    expect(
      isDuplicateBallotError(
        Object.assign(new Error("duplicate key"), { code: "23505", constraint: "IDX_garden_vote_proposal_customer_unique" })
      )
    ).toBe(true)
  })

  it.each([
    ["a primary-key collision", new MedusaError(MedusaError.Types.INVALID_DATA, "Garden vote with id: v1, already exists.")],
    ["another table's unique index", new MedusaError(MedusaError.Types.INVALID_DATA, "Garden proposal with proposal_id: p, customer_id: c, already exists.")],
    ["other invalid data", new MedusaError(MedusaError.Types.INVALID_DATA, "Value for GardenVote.vote is required")],
    ["the same text as another type", new MedusaError(MedusaError.Types.NOT_FOUND, "Garden vote with proposal_id: p, customer_id: c, already exists.")],
    ["a lost connection", new Error("Connection terminated unexpectedly")],
    // A bare 23505 names its constraint; only the ballot index is "already voted".
    ["a bare 23505 on the primary key", Object.assign(new Error("duplicate key"), { code: "23505", constraint: "garden_vote_pkey" })],
    ["a bare 23505 naming no constraint", Object.assign(new Error("duplicate key"), { code: "23505" })],
    ["nothing", undefined],
  ])("does not match %s", (_label, error) => {
    expect(isDuplicateBallotError(error)).toBe(false)
  })
})

describe("isBallotChoice", () => {
  it("accepts the three tally columns' choices and nothing else", () => {
    expect(["for", "against", "abstain"].every(isBallotChoice)).toBe(true)
    for (const other of ["FOR", "yes", "", "toString", "__proto__", 1, null, undefined]) {
      expect(isBallotChoice(other)).toBe(false)
    }
  })
})
