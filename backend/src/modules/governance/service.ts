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

/** The partial unique index that allows one live ballot per member per proposal. */
export const UNIQUE_BALLOT_INDEX = "IDX_garden_vote_proposal_customer_unique"

/**
 * Whether `error` is the unique ballot index refusing a second live ballot.
 *
 * The driver reports 23505, but the generated CRUD does not let that reach
 * the caller: Medusa's `dbErrorMapper` rethrows it as INVALID_DATA with the
 * message "Garden vote with proposal_id: …, customer_id: …, already exists."
 * (observed on Postgres, store-proposal-votes-race.spec.ts). So that exact
 * shape is matched, naming this index's two columns. A bare 23505 (the
 * mapper bypassed) counts only when it names this index: the driver's error
 * carries `constraint`, and MikroORM's exception copies it. A primary-key
 * collision is also 23505, and must not be answered as "already voted".
 */
export function isDuplicateBallotError(error: unknown): boolean {
  const err = error as { code?: string; constraint?: string; type?: string; message?: string } | null
  if (err?.code === "23505") return err.constraint === UNIQUE_BALLOT_INDEX
  return (
    err?.type === MedusaError.Types.INVALID_DATA &&
    /^Garden vote with proposal_id: .*, customer_id: .*, already exists\.$/s.test(err.message ?? "")
  )
}

/**
 * Thrown inside the ballot's transaction when the proposal is no longer open
 * (not `active`, past `voting_end`, or deleted) by the time the tally is
 * written, so the ballot rolls back with it. `castBallot` turns it into
 * `{ outcome: "voting_closed" }`; it does not leave the service.
 */
class VotingClosedError extends Error {
  constructor(proposalId: string) {
    super(`Voting is not open for proposal ${proposalId}`)
    this.name = "VotingClosedError"
  }
}

export type CastBallotResult =
  | { outcome: "cast"; vote: { id: string } & Record<string, unknown> }
  | { outcome: "already_voted" }
  | { outcome: "voting_closed" }

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
   * Record one member's ballot and add it to the proposal's tally. The
   * outcome is `already_voted` when that member already has a live ballot on
   * the proposal, and `voting_closed` when the proposal stopped accepting
   * ballots after the route read it.
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
   *   and no ballot is written without its increment;
   * - the tally UPDATE re-checks `status = 'active'` and `voting_end`, so a
   *   ballot whose request read an open proposal cannot commit after
   *   `finalizeProposalWorkflow` (jobs/close-garden-proposals.ts) set the
   *   result, or after voting closed. The UPDATE waits on the proposal row
   *   while a finalize holds it and re-reads the committed status. What is
   *   left: a ballot whose UPDATE ran before `voting_end` and commits a few
   *   milliseconds after a finalize read the tally, which needs that finalize
   *   to run within those milliseconds of `voting_end`.
   *
   * Raw SQL for the tally because the generated `updateGardenProposals` can
   * only write values computed from an earlier read. The bigNumber columns'
   * `raw_*` JSONB companions are written from the same expression, so the ORM
   * reads back what the NUMERIC column holds. Column names come from
   * `TALLY_COLUMN`, never from input.
   */
  async castBallot(ballot: BallotInput): Promise<CastBallotResult> {
    try {
      return { outcome: "cast", vote: await this.castBallotInTransaction_(ballot) }
    } catch (error) {
      if (isDuplicateBallotError(error)) return { outcome: "already_voted" }
      if (error instanceof VotingClosedError) return { outcome: "voting_closed" }
      throw error
    }
  }

  @InjectTransactionManager()
  protected async castBallotInTransaction_(
    ballot: BallotInput,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<{ id: string } & Record<string, unknown>> {
    const column = TALLY_COLUMN[ballot.vote]
    const created = (await this.createGardenVotes(ballot, sharedContext)) as unknown as { id: string } &
      Record<string, unknown>

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
        WHERE "id" = ?
          AND "deleted_at" IS NULL
          AND "status" = 'active'
          AND "voting_end" > statement_timestamp()
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
      // Closed, finalized or deleted after the route read it: roll the
      // ballot back with the transaction.
      throw new VotingClosedError(ballot.proposal_id)
    }
    return created
  }
}

export default GovernanceModuleService
