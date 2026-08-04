import { MedusaService, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  DemandPost,
  DemandParticipant,
  DemandBounty,
  SupplierProposal,
  ProposalVote,
} from "./models"
import { DemandPostStatus, DemandPostVisibility } from "./models/demand-post"
import { ParticipantStatus } from "./models/demand-participant"
import { BountyObjective, BountyStatus, BountyVisibility } from "./models/demand-bounty"
import { ProposalStatus } from "./models/supplier-proposal"

class DemandPoolModuleService extends MedusaService({
  DemandPost,
  DemandParticipant,
  DemandBounty,
  SupplierProposal,
  ProposalVote,
}) {
  // ──────────────────────────────────────────────────────────────────────────
  // Status transition maps
  // ──────────────────────────────────────────────────────────────────────────

  private readonly DEMAND_TRANSITIONS: Record<string, string[]> = {
    [DemandPostStatus.DRAFT]: [DemandPostStatus.OPEN, DemandPostStatus.CANCELLED],
    [DemandPostStatus.OPEN]: [
      DemandPostStatus.THRESHOLD_MET,
      DemandPostStatus.NEGOTIATING,
      DemandPostStatus.CANCELLED,
      DemandPostStatus.EXPIRED,
    ],
    [DemandPostStatus.THRESHOLD_MET]: [
      DemandPostStatus.NEGOTIATING,
      DemandPostStatus.DEAL_APPROVED,
      DemandPostStatus.CANCELLED,
    ],
    [DemandPostStatus.NEGOTIATING]: [
      DemandPostStatus.DEAL_APPROVED,
      DemandPostStatus.OPEN,
      DemandPostStatus.CANCELLED,
    ],
    [DemandPostStatus.DEAL_APPROVED]: [
      DemandPostStatus.ORDER_PLACED,
      DemandPostStatus.CANCELLED,
    ],
    [DemandPostStatus.ORDER_PLACED]: [
      DemandPostStatus.FULFILLED,
      DemandPostStatus.CANCELLED,
    ],
    [DemandPostStatus.FULFILLED]: [],
    [DemandPostStatus.CANCELLED]: [],
    [DemandPostStatus.EXPIRED]: [DemandPostStatus.OPEN],
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Demand Post Operations
  // ──────────────────────────────────────────────────────────────────────────

  async createDemandPost(input: {
    creator_id: string
    creator_type?: string
    title: string
    description: string
    category?: string
    specs?: Record<string, unknown>
    target_quantity: number
    min_quantity: number
    unit_of_measure?: string
    target_price?: number
    currency_code?: string
    delivery_region?: string
    delivery_address?: Record<string, unknown>
    delivery_window_start?: Date
    delivery_window_end?: Date
    deadline?: Date
    deadline_type?: string
    visibility?: string
    parent_demand_id?: string
    recurring_rule?: string
    cooperative_id?: string
    launch_id?: string
    product_id?: string
    metadata?: Record<string, unknown>
  }) {
    if (input.min_quantity > input.target_quantity) {
      throw new Error("Minimum quantity cannot exceed target quantity")
    }

    const [post] = await this.createDemandPosts([
      {
        ...input,
        creator_type: (input.creator_type || "CUSTOMER") as "CUSTOMER" | "SELLER",
        deadline_type: (input.deadline_type || "SOFT") as "HARD" | "SOFT",
        visibility: (input.visibility || DemandPostVisibility.PUBLIC) as DemandPostVisibility,
        delivery_address: (input.delivery_address || null) as Record<string, unknown> | null,
        specs: (input.specs || null) as Record<string, unknown> | null,
        status: DemandPostStatus.DRAFT,
        committed_quantity: 0,
        total_bounty_amount: 0,
        total_escrowed: 0,
        attractiveness_score: 0,
        is_template: false,
      },
    ])

    return post
  }

  async publishDemandPost(id: string) {
    return this.transitionDemandStatus(id, DemandPostStatus.OPEN)
  }

  async transitionDemandStatus(id: string, newStatus: string) {
    const posts = await this.listDemandPosts({ id })
    if (posts.length === 0) {
      throw new Error(`Demand post ${id} not found`)
    }

    const post = posts[0]
    const validTargets = this.DEMAND_TRANSITIONS[post.status] || []
    if (!validTargets.includes(newStatus)) {
      throw new Error(
        `Cannot transition demand post from "${post.status}" to "${newStatus}". ` +
          `Valid: ${validTargets.join(", ") || "none (terminal)"}`
      )
    }

    await this.updateDemandPosts({ id, status: newStatus as DemandPostStatus })
    const [updated] = await this.listDemandPosts({ id })
    return updated
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Participant Operations
  // ──────────────────────────────────────────────────────────────────────────

  async joinDemandPool(input: {
    demand_post_id: string
    customer_id: string
    quantity_committed: number
    price_willing_to_pay?: number
  }) {
    const posts = await this.listDemandPosts({ id: input.demand_post_id })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    const post = posts[0]
    if (
      post.status !== DemandPostStatus.OPEN &&
      post.status !== DemandPostStatus.THRESHOLD_MET
    ) {
      throw new Error(
        `Cannot join demand pool with status "${post.status}". Must be OPEN or THRESHOLD_MET.`
      )
    }

    // Check for existing participation
    const existing = await this.listDemandParticipants({
      demand_post_id: input.demand_post_id,
      customer_id: input.customer_id,
    })
    if (existing.length > 0 && existing[0].status !== ParticipantStatus.WITHDRAWN) {
      throw new Error("Already participating in this demand pool")
    }

    const [participant] = await this.createDemandParticipants([
      {
        demand_post_id: input.demand_post_id,
        customer_id: input.customer_id,
        quantity_committed: input.quantity_committed,
        price_willing_to_pay: input.price_willing_to_pay,
        status: ParticipantStatus.COMMITTED,
        vote_weight: input.quantity_committed,
        joined_at: new Date(),
      },
    ])

    // Update committed quantity and attractiveness
    const newCommitted =
      Number(post.committed_quantity) + input.quantity_committed
    const attractiveness = this.calculateAttractiveness(
      newCommitted,
      Number(post.target_quantity),
      Number(post.total_bounty_amount)
    )

    const updateData: Record<string, unknown> = {
      id: input.demand_post_id,
      committed_quantity: newCommitted,
      attractiveness_score: attractiveness,
    }

    // Auto-transition to THRESHOLD_MET
    if (
      newCommitted >= Number(post.min_quantity) &&
      post.status === DemandPostStatus.OPEN
    ) {
      updateData.status = DemandPostStatus.THRESHOLD_MET
    }

    await this.updateDemandPosts(updateData)

    return participant
  }

  async withdrawFromPool(demandPostId: string, customerId: string) {
    const participants = await this.listDemandParticipants({
      demand_post_id: demandPostId,
      customer_id: customerId,
    })
    if (participants.length === 0) {
      throw new Error("Not a participant in this demand pool")
    }

    const participant = participants[0]
    if (participant.status === ParticipantStatus.WITHDRAWN) {
      throw new Error("Already withdrawn")
    }

    await this.updateDemandParticipants({
      id: participant.id,
      status: ParticipantStatus.WITHDRAWN,
    })

    // Update committed quantity
    const posts = await this.listDemandPosts({ id: demandPostId })
    if (posts.length > 0) {
      const post = posts[0]
      const newCommitted = Math.max(
        0,
        Number(post.committed_quantity) - Number(participant.quantity_committed)
      )
      const attractiveness = this.calculateAttractiveness(
        newCommitted,
        Number(post.target_quantity),
        Number(post.total_bounty_amount)
      )
      await this.updateDemandPosts({
        id: demandPostId,
        committed_quantity: newCommitted,
        attractiveness_score: attractiveness,
      })
    }

    return participant
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Bounty Operations
  // ──────────────────────────────────────────────────────────────────────────

  async addBounty(input: {
    demand_post_id: string
    contributor_id: string
    contributor_type?: string
    objective: string
    amount: number
    currency_code?: string
    milestones?: Array<{
      description: string
      percentage: number
      condition: string
    }>
    visibility?: string
  }) {
    const posts = await this.listDemandPosts({ id: input.demand_post_id })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    // Milestone percentages must sum to exactly 100 so the full bounty
    // amount is accounted for across payouts.
    if (input.milestones && input.milestones.length > 0) {
      const total = input.milestones.reduce(
        (sum, m) => sum + m.percentage,
        0
      )
      if (total !== 100) {
        throw new Error("Bounty milestone percentages must sum to 100")
      }
    }

    const [bounty] = await this.createDemandBounties([
      {
        demand_post_id: input.demand_post_id,
        contributor_id: input.contributor_id,
        contributor_type: (input.contributor_type || "CUSTOMER") as "CUSTOMER" | "SELLER",
        objective: input.objective as BountyObjective,
        amount: input.amount,
        currency_code: input.currency_code || "USD",
        milestones: (input.milestones || null) as Record<string, unknown> | null,
        milestones_completed: 0,
        amount_paid_out: 0,
        status: BountyStatus.ACTIVE,
        visibility: (input.visibility || "PUBLIC") as BountyVisibility,
      },
    ])

    // Update total bounty on demand post
    const post = posts[0]
    const newTotal = Number(post.total_bounty_amount) + input.amount
    const attractiveness = this.calculateAttractiveness(
      Number(post.committed_quantity),
      Number(post.target_quantity),
      newTotal
    )
    await this.updateDemandPosts({
      id: input.demand_post_id,
      total_bounty_amount: newTotal,
      attractiveness_score: attractiveness,
    })

    return bounty
  }

  /**
   * Resolve a knex-style pg connection with `.raw` for atomic updates the
   * MedusaService CRUD can't express. Mirrors the resolver in
   * modules/hawala-ledger/service.ts. Returns undefined when no connection is
   * reachable (e.g. unit tests without DI).
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
        (this as any).baseRepository_?.getActiveManager?.() ??
        container?.manager
      const knex = em?.getConnection?.()?.getKnex?.()
      if (knex?.raw) return knex
    } catch {
      // no reachable connection
    }
    return undefined
  }

  async completeBountyMilestone(
    bountyId: string,
    milestoneIndex: number,
    demandPostId: string
  ) {
    // The `:id` pool segment on the route is an authorization boundary, so the
    // bounty lookup is scoped to it here rather than only at the caller. A
    // bounty belonging to a different pool must be indistinguishable from one
    // that does not exist — otherwise a caller authorized on pool A can drive
    // a completion against a bounty in pool B.
    const bounties = await this.listDemandBounties({
      id: bountyId,
      demand_post_id: demandPostId,
    })
    if (bounties.length === 0) {
      throw new Error("Bounty not found")
    }

    const bounty = bounties[0]
    if (bounty.status !== BountyStatus.ACTIVE && bounty.status !== BountyStatus.MILESTONE_PARTIAL) {
      throw new Error(`Cannot complete milestone on bounty with status "${bounty.status}"`)
    }

    const milestones = (bounty.milestones || []) as Array<{
      description: string
      percentage: number
      condition: string
      completed?: boolean
    }>

    if (milestoneIndex >= milestones.length) {
      throw new Error("Invalid milestone index")
    }

    if (milestones[milestoneIndex].completed) {
      throw new Error("Milestone already completed")
    }

    const payoutAmount =
      (Number(bounty.amount) * milestones[milestoneIndex].percentage) / 100
    const totalMilestones = milestones.length

    // Atomic per-index completion (B-money-10). A single UPDATE flips exactly
    // this milestone's `completed` flag via jsonb_set (so a concurrent
    // completion of a DIFFERENT index cannot clobber it via a whole-array
    // overwrite) and bumps milestones_completed / amount_paid_out with
    // `col = col + delta`. The WHERE guard makes double-completion of the same
    // index a no-op (rowCount 0). demand_bounty stores amount_paid_out as a
    // plain NUMERIC with no `raw_` sibling, so the raw-SQL increment is read
    // back correctly by the ORM.
    //
    // `?::int` in the guard is load-bearing, not decoration. `->` is overloaded:
    // with an INTEGER it indexes into a jsonb array, with TEXT it looks up an
    // object key. The driver binds this parameter as text, so an uncast `?`
    // selected the text overload — an object-key lookup against an array, which
    // is always NULL. `COALESCE(NULL, false) = false` is then always true, and
    // the guard silently passed for every caller: the same milestone could be
    // completed repeatedly, each pass adding its payout again. Proven, and now
    // held, by `__tests__/milestone-cas.integration.spec.ts`.
    const pg = this.resolvePgConnection()
    if (pg) {
      const result = await pg.raw(
        `UPDATE demand_bounty
            SET milestones = jsonb_set(milestones, array[?::text, 'completed'], 'true'::jsonb),
                milestones_completed = milestones_completed + 1,
                amount_paid_out = amount_paid_out + ?,
                status = (CASE WHEN milestones_completed + 1 >= ? THEN 'COMPLETED' ELSE 'MILESTONE_PARTIAL' END)::bounty_status_enum,
                updated_at = NOW()
          WHERE id = ?
            AND demand_post_id = ?
            AND deleted_at IS NULL
            AND status IN ('ACTIVE', 'MILESTONE_PARTIAL')
            AND COALESCE((milestones -> ?::int ->> 'completed')::boolean, false) = false
        RETURNING milestones_completed, amount_paid_out, status`,
        [
          milestoneIndex,
          payoutAmount,
          totalMilestones,
          bountyId,
          demandPostId,
          milestoneIndex,
        ]
      )
      const row = result?.rows?.[0]
      if (!row) {
        // Nothing updated → the milestone was completed (or the bounty left a
        // payable status) between our read and this write.
        throw new Error("Milestone already completed")
      }
      const completedCount = Number(row.milestones_completed)
      return {
        bounty_id: bountyId,
        milestone_index: milestoneIndex,
        payout_amount: payoutAmount,
        total_paid_out: Number(row.amount_paid_out),
        new_status: row.status as BountyStatus,
        all_completed: completedCount >= totalMilestones,
      }
    }

    // Fallback (no reachable pg connection, e.g. unit tests without DI):
    // re-read and do a best-effort read-modify-write off the freshest state.
    const fresh = await this.listDemandBounties({
      id: bountyId,
      demand_post_id: demandPostId,
    })
    if (fresh.length === 0) {
      throw new Error("Bounty not found")
    }
    const freshBounty = fresh[0]
    if (
      freshBounty.status !== BountyStatus.ACTIVE &&
      freshBounty.status !== BountyStatus.MILESTONE_PARTIAL
    ) {
      throw new Error(
        `Cannot complete milestone on bounty with status "${freshBounty.status}"`
      )
    }
    const freshMilestones = (freshBounty.milestones || []) as Array<{
      description: string
      percentage: number
      condition: string
      completed?: boolean
    }>
    if (freshMilestones[milestoneIndex]?.completed) {
      throw new Error("Milestone already completed")
    }

    freshMilestones[milestoneIndex].completed = true
    const completedCount = freshMilestones.filter((m) => m.completed).length
    const totalPaidOut = Number(freshBounty.amount_paid_out) + payoutAmount
    const newStatus =
      completedCount === totalMilestones
        ? BountyStatus.COMPLETED
        : BountyStatus.MILESTONE_PARTIAL

    await this.updateDemandBounties({
      id: bountyId,
      milestones: freshMilestones as unknown as Record<string, unknown>,
      milestones_completed: completedCount,
      amount_paid_out: totalPaidOut,
      status: newStatus,
    })

    return {
      bounty_id: bountyId,
      milestone_index: milestoneIndex,
      payout_amount: payoutAmount,
      total_paid_out: totalPaidOut,
      new_status: newStatus,
      all_completed: completedCount === totalMilestones,
    }
  }

  /**
   * First-come claim of an unassigned bounty. Throws if already claimed.
   *
   * The claim is decided by a DB-atomic
   * `UPDATE ... SET assignee_id = :actor WHERE assignee_id IS NULL`, so
   * concurrent claimants cannot both win.
   */
  async claimBounty(
    bountyId: string,
    actorId: string,
    actorType: "CUSTOMER" | "SELLER" | "ORGANIZER",
    demandPostId: string
  ) {
    // Pool-scoped for the same reason as `completeBountyMilestone`: the route's
    // `:id` segment must actually constrain which bounty is reachable.
    const bounties = await this.listDemandBounties({
      id: bountyId,
      demand_post_id: demandPostId,
    })
    if (bounties.length === 0) {
      throw new Error("Bounty not found")
    }

    const bounty = bounties[0]
    if (bounty.assignee_id) {
      throw new Error("Bounty already claimed")
    }

    // Atomic first-come claim. The read above only reports what was true a
    // moment ago, so the `assignee_id IS NULL` predicate is what actually
    // decides the race: two simultaneous claimants both pass the read, but
    // exactly one updates a row. Without it, the later writer silently
    // overwrote the earlier claimant and the bounty paid out to the wrong
    // person.
    const pg = this.resolvePgConnection()
    if (pg) {
      const result = await pg.raw(
        `UPDATE demand_bounty
            SET assignee_id = ?,
                assignee_type = ?::bounty_assignee_type_enum,
                updated_at = NOW()
          WHERE id = ?
            AND demand_post_id = ?
            AND deleted_at IS NULL
            AND assignee_id IS NULL
        RETURNING id`,
        [actorId, actorType, bountyId, demandPostId]
      )
      if (!result?.rows?.[0]) {
        // The row existed a moment ago, so this is a lost race rather than a
        // missing bounty.
        throw new Error("Bounty already claimed")
      }
      const [updated] = await this.listDemandBounties({ id: bountyId })
      return updated
    }

    // Fallback (no reachable pg connection, e.g. unit tests without DI).
    await this.updateDemandBounties({
      id: bountyId,
      assignee_id: actorId,
      assignee_type: actorType,
    })

    const [updated] = await this.listDemandBounties({ id: bountyId })
    return updated
  }

  /**
   * Creator-driven assignment of a bounty to a specific actor,
   * overriding any existing assignee.
   */
  async assignBounty(
    bountyId: string,
    actorId: string,
    actorType: "CUSTOMER" | "SELLER" | "ORGANIZER"
  ) {
    const bounties = await this.listDemandBounties({ id: bountyId })
    if (bounties.length === 0) {
      throw new Error("Bounty not found")
    }

    await this.updateDemandBounties({
      id: bountyId,
      assignee_id: actorId,
      assignee_type: actorType,
    })

    const [updated] = await this.listDemandBounties({ id: bountyId })
    return updated
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Supplier Proposal Operations
  // ──────────────────────────────────────────────────────────────────────────

  async submitProposal(input: {
    demand_post_id: string
    supplier_id: string
    unit_price: number
    currency_code?: string
    min_quantity: number
    max_quantity?: number
    volume_tiers?: Array<{
      min_qty: number
      max_qty: number
      unit_price: number
    }>
    fulfillment_timeline_days?: number
    delivery_method?: string
    delivery_cost?: number
    certifications?: string[]
    compliance_notes?: string
    payment_terms?: string
    notes?: string
  }) {
    const posts = await this.listDemandPosts({ id: input.demand_post_id })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    const post = posts[0]
    const validStatuses = [
      DemandPostStatus.OPEN,
      DemandPostStatus.THRESHOLD_MET,
      DemandPostStatus.NEGOTIATING,
    ]
    if (!validStatuses.includes(post.status as DemandPostStatus)) {
      throw new Error(
        `Cannot submit proposals to demand post with status "${post.status}"`
      )
    }

    const [proposal] = await this.createSupplierProposals([
      {
        ...input,
        currency_code: input.currency_code || "USD",
        certifications: (input.certifications || null) as Record<string, unknown> | null,
        volume_tiers: (input.volume_tiers || null) as Record<string, unknown> | null,
        status: ProposalStatus.SUBMITTED,
        submitted_at: new Date(),
        votes_for: 0,
        votes_against: 0,
        vote_weight_for: 0,
        vote_weight_against: 0,
      },
    ])

    return proposal
  }

  async counterOfferProposal(
    proposalId: string,
    counterOffer: {
      proposed_price?: number
      proposed_quantity?: number
      proposed_terms?: string
      notes?: string
    }
  ) {
    const proposals = await this.listSupplierProposals({ id: proposalId })
    if (proposals.length === 0) {
      throw new Error("Proposal not found")
    }

    const proposal = proposals[0]
    if (
      proposal.status !== ProposalStatus.SUBMITTED &&
      proposal.status !== ProposalStatus.UNDER_REVIEW &&
      proposal.status !== ProposalStatus.SHORTLISTED
    ) {
      throw new Error(`Cannot counter-offer proposal with status "${proposal.status}"`)
    }

    await this.updateSupplierProposals({
      id: proposalId,
      counter_offer: counterOffer,
      counter_offer_at: new Date(),
      status: ProposalStatus.COUNTER_OFFERED,
    })

    const [updated] = await this.listSupplierProposals({ id: proposalId })
    return updated
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Voting on Proposals
  // ──────────────────────────────────────────────────────────────────────────

  async voteOnProposal(input: {
    proposal_id: string
    demand_post_id: string
    voter_id: string
    vote: "FOR" | "AGAINST" | "ABSTAIN"
    comment?: string
  }) {
    // Verify voter is a participant
    const participants = await this.listDemandParticipants({
      demand_post_id: input.demand_post_id,
      customer_id: input.voter_id,
    })
    if (participants.length === 0 || participants[0].status === ParticipantStatus.WITHDRAWN) {
      throw new Error("Only active participants can vote on proposals")
    }

    // Check for existing vote
    const existingVotes = await this.listProposalVotes({
      proposal_id: input.proposal_id,
      voter_id: input.voter_id,
    })
    if (existingVotes.length > 0) {
      throw new Error("Already voted on this proposal")
    }

    const participant = participants[0]
    const weight = Number(participant.vote_weight) || 1

    const [vote] = await this.createProposalVotes([
      {
        proposal_id: input.proposal_id,
        demand_post_id: input.demand_post_id,
        voter_id: input.voter_id,
        vote: input.vote,
        weight,
        comment: input.comment,
        voted_at: new Date(),
      },
    ])

    // Update proposal vote counts
    const proposals = await this.listSupplierProposals({
      id: input.proposal_id,
    })
    if (proposals.length > 0) {
      const proposal = proposals[0]
      const updateData: Record<string, unknown> = { id: input.proposal_id }
      if (input.vote === "FOR") {
        updateData.votes_for = Number(proposal.votes_for) + 1
        updateData.vote_weight_for = Number(proposal.vote_weight_for) + weight
      } else if (input.vote === "AGAINST") {
        updateData.votes_against = Number(proposal.votes_against) + 1
        updateData.vote_weight_against =
          Number(proposal.vote_weight_against) + weight
      }
      await this.updateSupplierProposals(updateData)
    }

    return vote
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Deal Finalization
  // ──────────────────────────────────────────────────────────────────────────

  async selectSupplier(demandPostId: string, proposalId: string) {
    const posts = await this.listDemandPosts({ id: demandPostId })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    const proposals = await this.listSupplierProposals({ id: proposalId })
    if (proposals.length === 0) {
      throw new Error("Proposal not found")
    }

    const proposal = proposals[0]

    // Accept the selected proposal
    await this.updateSupplierProposals({
      id: proposalId,
      status: ProposalStatus.ACCEPTED,
      reviewed_at: new Date(),
    })

    // Reject other proposals
    const otherProposals = await this.listSupplierProposals({
      demand_post_id: demandPostId,
    })
    for (const other of otherProposals) {
      if (other.id !== proposalId && other.status !== ProposalStatus.WITHDRAWN) {
        await this.updateSupplierProposals({
          id: other.id,
          status: ProposalStatus.REJECTED,
          reviewed_at: new Date(),
        })
      }
    }

    // Calculate final price based on volume tiers
    const post = posts[0]
    const committedQty = Number(post.committed_quantity)
    const finalUnitPrice = this.calculateTieredPrice(
      Number(proposal.unit_price),
      committedQty,
      (proposal.volume_tiers || []) as Array<{
        min_qty: number
        max_qty: number
        unit_price: number
      }>
    )

    // Update demand post
    await this.updateDemandPosts({
      id: demandPostId,
      selected_supplier_id: proposal.supplier_id,
      final_unit_price: finalUnitPrice,
      final_total_price: finalUnitPrice * committedQty,
      status: DemandPostStatus.DEAL_APPROVED,
    })

    const [updated] = await this.listDemandPosts({ id: demandPostId })
    return updated
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Query Helpers
  // ──────────────────────────────────────────────────────────────────────────

  async getDemandPoolDetails(demandPostId: string) {
    const posts = await this.listDemandPosts({ id: demandPostId })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    const [participants, proposals, bounties] = await Promise.all([
      this.listDemandParticipants({ demand_post_id: demandPostId }),
      this.listSupplierProposals({ demand_post_id: demandPostId }),
      this.listDemandBounties({ demand_post_id: demandPostId }),
    ])

    const post = posts[0]
    const activeParticipants = participants.filter(
      (p) => p.status !== ParticipantStatus.WITHDRAWN
    )

    return {
      ...post,
      participants: {
        total: activeParticipants.length,
        committed_quantity: Number(post.committed_quantity),
        target_quantity: Number(post.target_quantity),
        progress_percent: Math.min(
          100,
          (Number(post.committed_quantity) / Number(post.target_quantity)) * 100
        ),
        list: activeParticipants,
      },
      proposals: {
        total: proposals.length,
        list: proposals,
      },
      bounties: {
        total: bounties.length,
        total_amount: bounties.reduce(
          (sum, b) => sum + Number(b.amount),
          0
        ),
        list: bounties,
      },
    }
  }

  async getOpenDemandPools(filters?: {
    category?: string
    delivery_region?: string
    min_bounty?: number
    sort_by?: "attractiveness" | "deadline" | "quantity" | "bounty"
    limit?: number
    offset?: number
  }) {
    const queryFilters: Record<string, unknown> = {
      status: [DemandPostStatus.OPEN, DemandPostStatus.THRESHOLD_MET],
      visibility: "PUBLIC",
    }

    if (filters?.category) {
      queryFilters.category = filters.category
    }
    if (filters?.delivery_region) {
      queryFilters.delivery_region = filters.delivery_region
    }

    const orderBy: Record<string, string> = {}
    switch (filters?.sort_by) {
      case "attractiveness":
        orderBy.attractiveness_score = "DESC"
        break
      case "deadline":
        orderBy.deadline = "ASC"
        break
      case "quantity":
        orderBy.committed_quantity = "DESC"
        break
      case "bounty":
        orderBy.total_bounty_amount = "DESC"
        break
      default:
        orderBy.attractiveness_score = "DESC"
    }

    const posts = await this.listDemandPosts(queryFilters, {
      skip: filters?.offset || 0,
      take: filters?.limit || 20,
      order: orderBy,
    })

    return posts
  }

  async getSupplierOpportunities(
    supplierId: string,
    filters?: {
      category?: string
      delivery_region?: string
      min_quantity?: number
      limit?: number
      offset?: number
    }
  ) {
    // Get open demand pools that the supplier hasn't proposed to yet
    const openPools = await this.getOpenDemandPools({
      category: filters?.category,
      delivery_region: filters?.delivery_region,
      limit: filters?.limit || 50,
      offset: filters?.offset || 0,
    })

    const existingProposals = await this.listSupplierProposals({
      supplier_id: supplierId,
    })
    const proposedPostIds = new Set(
      existingProposals.map((p) => p.demand_post_id)
    )

    return openPools.filter((pool) => {
      if (proposedPostIds.has(pool.id)) return false
      if (
        filters?.min_quantity &&
        Number(pool.committed_quantity) < filters.min_quantity
      )
        return false
      return true
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Smart Matching
  // ──────────────────────────────────────────────────────────────────────────

  async suggestGroupBuys(customerId: string) {
    // Find demand posts matching the customer's interests
    const participation = await this.listDemandParticipants({
      customer_id: customerId,
    })
    const participatedPostIds = new Set(
      participation.map((p) => p.demand_post_id)
    )

    // Get categories from past participation
    const pastPosts = await Promise.all(
      Array.from(participatedPostIds)
        .slice(0, 10)
        .map((id) => this.listDemandPosts({ id }))
    )
    const categories = new Set<string>()
    for (const results of pastPosts) {
      for (const post of results) {
        if (post.category) categories.add(post.category as string)
      }
    }

    if (categories.size === 0) {
      // Return top-scoring open pools for new users
      return this.getOpenDemandPools({
        sort_by: "attractiveness",
        limit: 10,
      })
    }

    // Find open pools matching those categories
    const suggestions: any[] = []
    for (const category of categories) {
      const pools = await this.getOpenDemandPools({
        category,
        limit: 5,
      })
      suggestions.push(
        ...pools.filter((p) => !participatedPostIds.has(p.id))
      )
    }

    return suggestions.slice(0, 10)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────────────────────

  private calculateAttractiveness(
    committedQty: number,
    targetQty: number,
    totalBounty: number
  ): number {
    const qtyProgress = targetQty > 0 ? committedQty / targetQty : 0
    const bountyFactor = Math.min(totalBounty / 100, 5) // Cap bounty influence
    return Math.min(100, qtyProgress * 50 + bountyFactor * 10)
  }

  private calculateTieredPrice(
    basePrice: number,
    quantity: number,
    tiers: Array<{ min_qty: number; max_qty: number; unit_price: number }>
  ): number {
    if (!tiers || tiers.length === 0) return basePrice

    // Sort tiers by min_qty descending to find the best applicable tier
    const sortedTiers = [...tiers].sort((a, b) => b.min_qty - a.min_qty)
    for (const tier of sortedTiers) {
      if (quantity >= tier.min_qty) {
        return tier.unit_price
      }
    }

    return basePrice
  }
}

export default DemandPoolModuleService
