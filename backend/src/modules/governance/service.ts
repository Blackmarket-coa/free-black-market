import type { Context } from "@medusajs/framework/types"
import {
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"
import { GardenProposal, GardenVote, GardenRole, RoleAssignment, ProposalComment, VoteDelegation } from "./models"

/** The proposal tally column each ballot choice adds its voting power to. */
const TALLY_COLUMN = {
  for: "votes_for",
  against: "votes_against",
  abstain: "votes_abstain",
} as const

export type BallotChoice = keyof typeof TALLY_COLUMN

export function isBallotChoice(value: unknown): value is BallotChoice {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TALLY_COLUMN, value)
}

export type BallotInput = {
  proposal_id: string
  garden_id: string
  customer_id: string
  membership_id: string
  vote: BallotChoice
  voting_power: number
  power_basis: Record<string, unknown>
  comment: string | null
  comment_visibility: "public" | "members_only" | "private"
  is_delegated: boolean
  is_final: boolean
  voted_at: Date
}

/**
 * Whether `error` is the unique ballot index refusing a second live ballot.
 *
 * The driver reports 23505, but the generated CRUD does not let that reach
 * the caller: Medusa's `dbErrorMapper` rethrows it as INVALID_DATA with the
 * message "Garden vote with proposal_id: …, customer_id: …, already exists."
 * (observed on Postgres, store-proposal-votes-race.spec.ts). So that exact
 * shape is matched, naming this index's two columns, and a bare 23505 too in
 * case the mapper is bypassed. A generic "duplicate key" match would also
 * swallow a primary-key collision as "already voted".
 */
export function isDuplicateBallotError(error: unknown): boolean {
  const err = error as { code?: string; type?: string; message?: string } | null
  if (err?.code === "23505") return true
  return (
    err?.type === MedusaError.Types.INVALID_DATA &&
    /^Garden vote with proposal_id: .*, customer_id: .*, already exists\.$/s.test(err.message ?? "")
  )
}

type SqlManager = {
  execute(sql: string, params: unknown[], method: "all"): Promise<unknown[]>
}

/**
 * Governance Module Service
 *
 * Manages democratic governance for community gardens.
 */
export class GovernanceModuleService extends MedusaService({
  GardenProposal,
  GardenVote,
  GardenRole,
  RoleAssignment,
  ProposalComment,
  VoteDelegation,
}) {
  /**
   * Record one member's ballot and add it to the proposal's tally, or return
   * null when that member already has a ballot on the proposal.
   *
   * `POST /store/proposals/:id/votes` used to read "has this customer voted?",
   * insert, then write the tally as absolute values computed from a proposal
   * read at the start of the request. Concurrent requests from one member all
   * passed the read and each inserted a ballot (Postgres: 6 concurrent POSTs,
   * 4 to 6 ballots), and concurrent votes from different members overwrote
   * each other's increments (4 members, tally 1). Now:
   *
   * - one live ballot per (proposal, customer) is the partial unique index
   *   `IDX_garden_vote_proposal_customer_unique`, so the second insert fails
   *   and is answered as "already voted";
   * - the tally is one `UPDATE … SET col = col + ?`, which Postgres applies to
   *   the latest row version, so no increment is lost;
   * - both run in one transaction, so a refused ballot leaves no increment
   *   and no ballot is written without its increment.
   *
   * Raw SQL for the tally because the generated `updateGardenProposals` can
   * only write values computed from an earlier read. The bigNumber columns'
   * `raw_*` JSONB companions are written from the same expression, so the ORM
   * reads back what the NUMERIC column holds. Column names come from
   * `TALLY_COLUMN`, never from input.
   */
  async castBallot(ballot: BallotInput): Promise<{ id: string } | null> {
    try {
      return await this.castBallotInTransaction_(ballot)
    } catch (error) {
      if (isDuplicateBallotError(error)) return null
      throw error
    }
  }

  @InjectTransactionManager()
  protected async castBallotInTransaction_(
    ballot: BallotInput,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<{ id: string }> {
    const column = TALLY_COLUMN[ballot.vote]
    const created = (await this.createGardenVotes(ballot, sharedContext)) as unknown as { id: string }

    const raw = (col: string) =>
      `jsonb_build_object('value', trim_scale("${col}" + ?::numeric)::text, ` +
      `'precision', COALESCE(("raw_${col}"->>'precision')::int, 20))`
    const manager = sharedContext.transactionManager as SqlManager
    const rows = await manager.execute(
      `UPDATE "garden_proposal"
          SET "raw_${column}" = ${raw(column)},
              "${column}" = "${column}" + ?::numeric,
              "raw_total_voting_power" = ${raw("total_voting_power")},
              "total_voting_power" = "total_voting_power" + ?::numeric,
              "unique_voters" = "unique_voters" + 1,
              "updated_at" = now()
        WHERE "id" = ? AND "deleted_at" IS NULL
    RETURNING "id"`,
      [
        ballot.voting_power,
        ballot.voting_power,
        ballot.voting_power,
        ballot.voting_power,
        ballot.proposal_id,
      ],
      "all"
    )
    if (!Array.isArray(rows) || rows.length !== 1) {
      // The proposal was deleted after the route read it; roll the ballot back.
      throw new Error(`Proposal ${ballot.proposal_id} not found`)
    }
    return created
  }
}

export default GovernanceModuleService
