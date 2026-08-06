import { MedusaService, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import BarterProposal, { BarterStatus } from "./models/barter-proposal"

class BarterModuleService extends MedusaService({
  BarterProposal,
}) {
  /**
   * Offer to fulfil a demand post or bounty by trade.
   *
   * Exactly one target. A proposal attached to both a pool and a bounty would
   * be ambiguous about who gets to accept it, and "whoever accepts first" is
   * not a rule anyone would choose on purpose.
   */
  async proposeBarter(input: {
    proposer_id: string
    demand_post_id?: string | null
    bounty_id?: string | null
    offering: string
    wanting: string
    estimated_hours?: number | null
  }) {
    const hasPost = Boolean(input.demand_post_id)
    const hasBounty = Boolean(input.bounty_id)
    if (hasPost === hasBounty) {
      throw new Error(
        "A barter proposal must target exactly one of demand_post_id or bounty_id"
      )
    }

    const [created] = await this.createBarterProposals([
      {
        proposer_id: input.proposer_id,
        demand_post_id: input.demand_post_id ?? null,
        bounty_id: input.bounty_id ?? null,
        offering: input.offering,
        wanting: input.wanting,
        estimated_hours: input.estimated_hours ?? null,
        status: BarterStatus.PROPOSED,
      } as never,
    ])

    return created
  }

  /**
   * Accept a proposal.
   *
   * `accepterId` is checked against the pool's creator by the caller, which
   * holds the demand-pool service; this module deliberately knows nothing
   * about demand pools. What it enforces is what it can see: a proposal is
   * accepted once, by someone other than the person who made it.
   *
   * Guarded on `status = 'PROPOSED'` rather than read-check-write, so two
   * accepters cannot both believe they struck the deal.
   */
  async acceptBarter(proposalId: string, accepterId: string) {
    const proposals = await this.listBarterProposals({ id: proposalId })
    if (proposals.length === 0) {
      throw new Error("Barter proposal not found")
    }
    const proposal = proposals[0]

    if (proposal.proposer_id === accepterId) {
      throw new Error("A proposer cannot accept their own barter")
    }
    if (proposal.status !== BarterStatus.PROPOSED) {
      throw new Error(
        `Cannot accept a proposal with status "${proposal.status}"`
      )
    }

    const pg = this.resolvePgConnection()
    if (pg) {
      const result = await pg.raw(
        `UPDATE barter_proposal
            SET status = 'ACCEPTED',
                accepted_by = ?,
                accepted_at = NOW(),
                updated_at = NOW()
          WHERE id = ?
            AND deleted_at IS NULL
            AND status = 'PROPOSED'
        RETURNING id`,
        [accepterId, proposalId]
      )
      if (!result?.rows?.[0]) {
        throw new Error("This proposal has already been accepted")
      }
    } else {
      await this.updateBarterProposals({
        id: proposalId,
        status: BarterStatus.ACCEPTED,
        accepted_by: accepterId,
        accepted_at: new Date(),
      })
    }

    const [updated] = await this.listBarterProposals({ id: proposalId })
    return updated
  }

  /**
   * Mark an accepted trade done, recording the audit entry id.
   *
   * The ledger write itself happens in the caller — this module has no
   * business holding a ledger service, and the GIFT entry needs pool context
   * it does not have. Here we only record that it happened.
   */
  async completeBarter(proposalId: string, ledgerEntryId?: string | null) {
    const proposals = await this.listBarterProposals({ id: proposalId })
    if (proposals.length === 0) {
      throw new Error("Barter proposal not found")
    }
    if (proposals[0].status !== BarterStatus.ACCEPTED) {
      throw new Error(
        `Only an accepted proposal can be completed; this one is "${proposals[0].status}"`
      )
    }

    await this.updateBarterProposals({
      id: proposalId,
      status: BarterStatus.COMPLETED,
      completed_at: new Date(),
      ledger_entry_id: ledgerEntryId ?? null,
    })

    const [updated] = await this.listBarterProposals({ id: proposalId })
    return updated
  }

  /**
   * Resolve a raw pg connection. Same shape as demand-pool's helper —
   * an awilix container answers through `resolve()`, and the key is
   * `ContainerRegistrationKeys.PG_CONNECTION` ("__pg_connection__"), not a
   * hardcoded string. Getting either wrong returns undefined rather than
   * throwing, which would silently drop `acceptBarter` onto the unguarded
   * fallback while unit tests stayed green.
   */
  private resolvePgConnection():
    | { raw: (sql: string, bindings?: any[]) => Promise<any> }
    | undefined {
    const container = (this as any).__container__
    try {
      const pg =
        container?.resolve?.(ContainerRegistrationKeys.PG_CONNECTION) ??
        container?.[ContainerRegistrationKeys.PG_CONNECTION]
      if (pg?.raw) return pg
    } catch {
      // fall through
    }
    try {
      const em =
        (this as any).baseRepository_?.getActiveManager?.() ?? container?.manager
      const knex = em?.getConnection?.()?.getKnex?.()
      if (knex?.raw) return knex
    } catch {
      // no reachable connection
    }
    return undefined
  }
}

export default BarterModuleService
