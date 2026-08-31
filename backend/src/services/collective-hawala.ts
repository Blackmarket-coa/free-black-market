/**
 * Collective Purchase Hawala Integration
 *
 * Bridges the demand-pool and bargaining modules with the Hawala ledger
 * for escrow management, bounty payouts, and group payment processing.
 */

import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import type DemandPoolModuleService from "../modules/demand-pool/service"
import { ParticipantStatus } from "../modules/demand-pool/models/demand-participant"
import { DemandPostStatus } from "../modules/demand-pool/models/demand-post"
import { BountyStatus } from "../modules/demand-pool/models/demand-bounty"
import {
  requireMutualAidAccountId,
  shouldRouteToMutualAid,
} from "../lib/surplus-redirect"

/**
 * Platform's cut of a creator sponsorship, in percent. Unlike order platform
 * fees (which default to 3% and are seller-configurable via payout-config),
 * the sponsorship fee is a flat product-level 10% taken at payout time.
 */
export const SPONSORSHIP_PLATFORM_FEE_PERCENT = 10

const roundCents = (dollars: number) => Math.round(dollars * 100) / 100

export class CollectiveHawalaService {
  private hawalaService: HawalaLedgerModuleService
  private demandPoolService: DemandPoolModuleService

  constructor(
    hawalaService: HawalaLedgerModuleService,
    demandPoolService: DemandPoolModuleService
  ) {
    this.hawalaService = hawalaService
    this.demandPoolService = demandPoolService
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Escrow for Demand Pool Participants
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Lock funds in escrow when a buyer commits to a demand pool.
   * Moves funds from the buyer's wallet to the demand pool's escrow account.
   */
  async escrowParticipantFunds(input: {
    demand_post_id: string
    participant_id: string
    customer_id: string
    amount: number
  }) {
    // Get or create escrow account for this demand pool
    const escrowAccount = await this.getOrCreateDemandEscrow(
      input.demand_post_id
    )

    // Get customer's wallet
    const customerAccounts = await this.hawalaService.listLedgerAccounts({
      owner_type: "CUSTOMER",
      owner_id: input.customer_id,
      account_type: "USER_WALLET",
    })

    if (customerAccounts.length === 0) {
      throw new Error("Customer wallet not found")
    }

    const customerAccount = customerAccounts[0]
    if (Number(customerAccount.available_balance) < input.amount) {
      throw new Error(
        `Insufficient balance. Available: ${customerAccount.available_balance}, Required: ${input.amount}`
      )
    }

    // Transfer to escrow
    const entry = await this.hawalaService.createTransfer({
      debit_account_id: customerAccount.id,
      credit_account_id: escrowAccount.id,
      amount: input.amount,
      entry_type: "PURCHASE",
      description: `Escrow for demand pool ${input.demand_post_id}`,
      reference_type: "ORDER",
      reference_id: input.demand_post_id,
      idempotency_key: `demand-escrow-${input.participant_id}`,
    })

    // Update participant record
    await this.demandPoolService.updateDemandParticipants({
      id: input.participant_id,
      escrow_amount: input.amount,
      escrow_locked: true,
      ledger_entry_id: entry.id,
      status: ParticipantStatus.ESCROWED,
      escrowed_at: new Date(),
    })

    // Update demand post total escrowed
    const posts = await this.demandPoolService.listDemandPosts({
      id: input.demand_post_id,
    })
    if (posts.length > 0) {
      await this.demandPoolService.updateDemandPosts({
        id: input.demand_post_id,
        total_escrowed:
          Number(posts[0].total_escrowed) + input.amount,
        escrow_account_id: escrowAccount.id,
      })
    }

    return entry
  }

  /**
   * Release escrowed funds back to participants (e.g., on cancellation).
   */
  async releaseParticipantEscrow(input: {
    demand_post_id: string
    participant_id: string
    customer_id: string
  }) {
    const participants = await this.demandPoolService.listDemandParticipants({
      id: input.participant_id,
    })
    if (participants.length === 0) {
      throw new Error("Participant not found")
    }

    const participant = participants[0]
    if (!participant.escrow_locked || Number(participant.escrow_amount) === 0) {
      throw new Error("No escrowed funds to release")
    }

    const posts = await this.demandPoolService.listDemandPosts({
      id: input.demand_post_id,
    })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    const escrowAccountId = posts[0].escrow_account_id as string
    if (!escrowAccountId) {
      throw new Error("Escrow account not found")
    }

    // Get customer wallet
    const customerAccounts = await this.hawalaService.listLedgerAccounts({
      owner_type: "CUSTOMER",
      owner_id: input.customer_id,
      account_type: "USER_WALLET",
    })

    if (customerAccounts.length === 0) {
      throw new Error("Customer wallet not found")
    }

    const amount = Number(participant.escrow_amount)

    // Where this pledge goes. The participant's recorded choice is only
    // actioned when the mutual-aid rail is actually open — with the flag unset
    // a DONATE intent is kept but the money still returns to the buyer, which
    // is the safe direction to fail in.
    const routeToMutualAid = shouldRouteToMutualAid(
      participant.surplus_disposition as string | null
    )

    // Throws when the rail is open but no destination is configured, rather
    // than falling back to a platform-held account.
    const destinationId = routeToMutualAid
      ? requireMutualAidAccountId()
      : customerAccounts[0].id

    // Distinct idempotency keys per destination. One escrow must never be able
    // to produce both a refund and a redirect, and a shared key would make the
    // second call silently replay the first instead of rejecting it.
    const idempotencyKey = routeToMutualAid
      ? `demand-donate-${input.participant_id}`
      : `demand-release-${input.participant_id}`

    const entry = await this.hawalaService.createTransfer({
      debit_account_id: escrowAccountId,
      credit_account_id: destinationId,
      amount,
      // TRANSFER, not a new DONATION type: entry types are validated against
      // rails by posture-a-guard, and inventing one here would sit outside
      // that guard's vocabulary. The intent is carried in the description and
      // the distinct idempotency key.
      entry_type: routeToMutualAid ? "TRANSFER" : "REFUND",
      description: routeToMutualAid
        ? `Surplus redirected to mutual aid for demand pool ${input.demand_post_id}`
        : `Escrow release for demand pool ${input.demand_post_id}`,
      reference_type: "ORDER",
      reference_id: input.demand_post_id,
      idempotency_key: idempotencyKey,
    })

    // Update participant
    await this.demandPoolService.updateDemandParticipants({
      id: input.participant_id,
      escrow_amount: 0,
      escrow_locked: false,
      status: ParticipantStatus.REFUNDED,
    })

    // Update demand post
    await this.demandPoolService.updateDemandPosts({
      id: input.demand_post_id,
      total_escrowed: Math.max(
        0,
        Number(posts[0].total_escrowed) - amount
      ),
    })

    return entry
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Bounty Escrow & Payouts
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Escrow bounty funds when a buyer creates a demand bounty.
   */
  async escrowBountyFunds(input: {
    demand_post_id: string
    bounty_id: string
    contributor_id: string
    amount: number
  }) {
    const escrowAccount = await this.getOrCreateDemandEscrow(
      input.demand_post_id
    )

    const contributorAccounts =
      await this.hawalaService.listLedgerAccounts({
        owner_id: input.contributor_id,
        account_type: "USER_WALLET",
      })

    if (contributorAccounts.length === 0) {
      throw new Error("Contributor wallet not found")
    }

    const contributorAccount = contributorAccounts[0]
    if (Number(contributorAccount.available_balance) < input.amount) {
      throw new Error("Insufficient balance for bounty escrow")
    }

    const entry = await this.hawalaService.createTransfer({
      debit_account_id: contributorAccount.id,
      credit_account_id: escrowAccount.id,
      amount: input.amount,
      entry_type: "FEE",
      description: `Bounty escrow for demand pool ${input.demand_post_id}`,
      reference_type: "DEMAND_BOUNTY",
      reference_id: input.bounty_id,
      idempotency_key: `bounty-escrow-${input.bounty_id}`,
    })

    // Update bounty record
    await this.demandPoolService.updateDemandBounties({
      id: input.bounty_id,
      escrowed: true,
      escrow_ledger_entry_id: entry.id,
    })

    return entry
  }

  /**
   * Pay out a bounty milestone to the assignee.
   */
  /**
   * Resolve both legs of a milestone payout without moving any money.
   *
   * Split out of `payBountyMilestone` so `completeAndPayMilestone` can prove
   * the transfer is possible *before* it commits the milestone completion.
   * The demand-pool module and the ledger service resolve separate
   * connections, so the completion and the transfer cannot share a
   * transaction — checking first is what keeps a failed payout from leaving a
   * committed completion behind.
   */
  private async resolveMilestonePayoutAccounts(input: {
    demand_post_id: string
    assignee_id: string
  }): Promise<{ escrowAccountId: string; assigneeAccountId: string }> {
    const posts = await this.demandPoolService.listDemandPosts({
      id: input.demand_post_id,
    })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    const escrowAccountId = posts[0].escrow_account_id as string
    if (!escrowAccountId) {
      throw new Error("Escrow account not found")
    }

    // Get assignee wallet (could be customer or seller)
    let assigneeAccounts = await this.hawalaService.listLedgerAccounts({
      owner_id: input.assignee_id,
      account_type: "USER_WALLET",
    })

    if (assigneeAccounts.length === 0) {
      assigneeAccounts = await this.hawalaService.listLedgerAccounts({
        owner_id: input.assignee_id,
        account_type: "SELLER_EARNINGS",
      })
    }

    if (assigneeAccounts.length === 0) {
      throw new Error("Assignee account not found")
    }

    return {
      escrowAccountId,
      assigneeAccountId: assigneeAccounts[0].id,
    }
  }

  async payBountyMilestone(input: {
    demand_post_id: string
    bounty_id: string
    milestone_index: number
    assignee_id: string
    amount: number
    milestone_description: string
    /** Pre-resolved accounts from a preflight check, to avoid re-resolving. */
    accounts?: { escrowAccountId: string; assigneeAccountId: string }
  }) {
    const { escrowAccountId, assigneeAccountId } =
      input.accounts ??
      (await this.resolveMilestonePayoutAccounts({
        demand_post_id: input.demand_post_id,
        assignee_id: input.assignee_id,
      }))

    const entry = await this.hawalaService.createTransfer({
      debit_account_id: escrowAccountId,
      credit_account_id: assigneeAccountId,
      amount: input.amount,
      entry_type: "TRANSFER",
      description: `Bounty payout: ${input.milestone_description}`,
      reference_type: "DEMAND_BOUNTY",
      reference_id: input.bounty_id,
      // Deterministic key so retries of the same milestone payout are
      // idempotent (createTransfer returns the existing entry on match).
      idempotency_key: `bounty-payout-${input.bounty_id}-m${input.milestone_index}`,
    })

    return entry
  }

  /**
   * Authorized milestone completion that also pays out the assignee.
   *
   * Completes the milestone on the bounty record (which enforces a
   * read-check-write concurrency guard), then transfers the milestone's
   * payout from escrow to the assignee's wallet. Optionally captures a
   * proof artifact on the bounty's metadata.
   */
  async completeAndPayMilestone(input: {
    demand_post_id: string
    bounty_id: string
    milestone_index: number
    proof?: { url?: string; note?: string }
  }) {
    // Preflight, in this order deliberately. The completion is a committed
    // atomic UPDATE that no later failure can roll back, so every precondition
    // for the payout is verified before it runs: the bounty must belong to
    // THIS pool, it must have an assignee, and both ledger legs must resolve.
    // Verifying afterwards would leave a failed payout as a bounty marked
    // complete with an inflated `amount_paid_out` and no money moved — which
    // also strands the escrowed remainder, since `refundBountyEscrow` only
    // returns `amount - amount_paid_out`.
    const bounties = await this.demandPoolService.listDemandBounties({
      id: input.bounty_id,
      demand_post_id: input.demand_post_id,
    })
    if (bounties.length === 0) {
      throw new Error("Bounty not found")
    }
    const bounty = bounties[0]

    if (!bounty.assignee_id) {
      throw new Error("Bounty has no assignee to pay")
    }

    const accounts = await this.resolveMilestonePayoutAccounts({
      demand_post_id: input.demand_post_id,
      assignee_id: bounty.assignee_id as string,
    })

    const completion = await this.demandPoolService.completeBountyMilestone(
      input.bounty_id,
      input.milestone_index,
      input.demand_post_id
    )

    const milestones = (bounty.milestones || []) as Array<{
      description: string
      percentage: number
      condition: string
      completed?: boolean
    }>
    const milestoneDescription =
      milestones[input.milestone_index]?.description ||
      `Milestone ${input.milestone_index}`

    const entry = await this.payBountyMilestone({
      demand_post_id: input.demand_post_id,
      bounty_id: input.bounty_id,
      milestone_index: input.milestone_index,
      assignee_id: bounty.assignee_id as string,
      amount: completion.payout_amount,
      milestone_description: milestoneDescription,
      accounts,
    })

    if (input.proof) {
      const existingMetadata = (bounty.metadata || {}) as Record<string, unknown>
      const proofs = Array.isArray(
        (existingMetadata as { proofs?: unknown }).proofs
      )
        ? ((existingMetadata as { proofs: unknown[] }).proofs as unknown[])
        : []
      await this.demandPoolService.updateDemandBounties({
        id: input.bounty_id,
        metadata: {
          ...existingMetadata,
          proofs: [
            ...proofs,
            {
              milestone_index: input.milestone_index,
              ...input.proof,
              captured_at: new Date().toISOString(),
            },
          ],
        } as Record<string, unknown>,
      })
    }

    return {
      ...completion,
      ledger_entry_id: entry.id,
    }
  }

  /**
   * Refund the un-paid remainder of a bounty's escrow back to its
   * contributor (e.g. when the demand pool is cancelled or expires).
   * No-op (returns null) if the bounty is already fully paid out.
   */
  async refundBountyEscrow(input: {
    demand_post_id: string
    bounty_id: string
  }) {
    const bounties = await this.demandPoolService.listDemandBounties({
      id: input.bounty_id,
    })
    if (bounties.length === 0) {
      throw new Error("Bounty not found")
    }
    const bounty = bounties[0]

    const remainder =
      Number(bounty.amount) - Number(bounty.amount_paid_out)
    if (remainder <= 0) {
      return null
    }

    const posts = await this.demandPoolService.listDemandPosts({
      id: input.demand_post_id,
    })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }
    const escrowAccountId = posts[0].escrow_account_id as string
    if (!escrowAccountId) {
      throw new Error("Escrow account not found")
    }

    const contributorAccounts = await this.hawalaService.listLedgerAccounts({
      owner_id: bounty.contributor_id,
      account_type: "USER_WALLET",
    })
    if (contributorAccounts.length === 0) {
      throw new Error("Contributor wallet not found")
    }

    const entry = await this.hawalaService.createTransfer({
      debit_account_id: escrowAccountId,
      credit_account_id: contributorAccounts[0].id,
      amount: remainder,
      entry_type: "REFUND",
      description: `Bounty escrow refund for demand pool ${input.demand_post_id}`,
      reference_type: "DEMAND_BOUNTY",
      reference_id: input.bounty_id,
      idempotency_key: `bounty-refund-${input.bounty_id}`,
    })

    await this.demandPoolService.updateDemandBounties({
      id: input.bounty_id,
      status: BountyStatus.CANCELLED,
    })

    return entry
  }

  /**
   * Refund all active/partial bounties for a demand pool. Continues on
   * per-bounty errors and collects the outcome for each.
   */
  async refundAllBounties(demandPostId: string) {
    const bounties = await this.demandPoolService.listDemandBounties({
      demand_post_id: demandPostId,
      status: ["ACTIVE", "MILESTONE_PARTIAL"],
    })

    const results: Array<{
      bounty_id: string
      status: "refunded" | "skipped" | "failed"
      entry_id?: string
      error?: string
    }> = []

    for (const bounty of bounties) {
      try {
        const entry = await this.refundBountyEscrow({
          demand_post_id: demandPostId,
          bounty_id: bounty.id,
        })
        results.push({
          bounty_id: bounty.id,
          status: entry ? "refunded" : "skipped",
          entry_id: entry?.id,
        })
      } catch (error: any) {
        results.push({
          bounty_id: bounty.id,
          status: "failed",
          error: error.message,
        })
      }
    }

    return results
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Creator Sponsorship Escrow & Payout
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Lock a producer's sponsorship budget in escrow when they sponsor a creator.
   * Mirrors `escrowBountyFunds`: moves funds from the producer's wallet into a
   * per-sponsorship escrow account. Idempotent on `sponsorship-escrow-${id}`.
   * All amounts are in dollars (the ledger's working unit).
   */
  async escrowSponsorshipFunds(input: {
    sponsorship_id: string
    producer_id: string
    amount: number
  }) {
    const escrowAccount = await this.getOrCreateSponsorshipEscrow(
      input.sponsorship_id
    )

    const producerAccounts = await this.hawalaService.listLedgerAccounts({
      owner_id: input.producer_id,
      account_type: "USER_WALLET",
    })
    if (producerAccounts.length === 0) {
      throw new Error("Producer wallet not found")
    }

    const producerAccount = producerAccounts[0]
    if (Number(producerAccount.available_balance) < input.amount) {
      throw new Error("Insufficient balance for sponsorship escrow")
    }

    return this.hawalaService.createTransfer({
      debit_account_id: producerAccount.id,
      credit_account_id: escrowAccount.id,
      amount: input.amount,
      entry_type: "FEE",
      description: `Sponsorship escrow ${input.sponsorship_id}`,
      reference_type: "SPONSORSHIP",
      reference_id: input.sponsorship_id,
      idempotency_key: `sponsorship-escrow-${input.sponsorship_id}`,
    })
  }

  /**
   * Pay out a sponsorship once the creator has delivered. Splits the escrowed
   * amount into exactly two ledger entries — a 10% platform fee and the 90%
   * creator payout — each with a deterministic idempotency key so retries are
   * safe. The two legs always sum to the original amount (fee is rounded to the
   * cent, the creator gets the remainder).
   */
  async paySponsorship(input: {
    sponsorship_id: string
    creator_id: string
    amount: number
  }) {
    const escrowAccount = await this.getOrCreateSponsorshipEscrow(
      input.sponsorship_id
    )

    const platformFee = roundCents(
      input.amount * (SPONSORSHIP_PLATFORM_FEE_PERCENT / 100)
    )
    const creatorAmount = roundCents(input.amount - platformFee)

    // Creators earn into SELLER_EARNINGS; fall back to a plain wallet.
    let creatorAccounts = await this.hawalaService.listLedgerAccounts({
      owner_id: input.creator_id,
      account_type: "SELLER_EARNINGS",
    })
    if (creatorAccounts.length === 0) {
      creatorAccounts = await this.hawalaService.listLedgerAccounts({
        owner_id: input.creator_id,
        account_type: "USER_WALLET",
      })
    }
    if (creatorAccounts.length === 0) {
      throw new Error("Creator earnings account not found")
    }

    const platformAccount =
      await this.hawalaService.getOrCreateSystemAccount("PLATFORM_FEE")

    const feeEntry = await this.hawalaService.createTransfer({
      debit_account_id: escrowAccount.id,
      credit_account_id: platformAccount.id,
      amount: platformFee,
      entry_type: "COMMISSION",
      description: `Sponsorship platform fee ${input.sponsorship_id}`,
      reference_type: "SPONSORSHIP",
      reference_id: input.sponsorship_id,
      idempotency_key: `sponsorship-fee-${input.sponsorship_id}`,
    })

    const payoutEntry = await this.hawalaService.createTransfer({
      debit_account_id: escrowAccount.id,
      credit_account_id: creatorAccounts[0].id,
      amount: creatorAmount,
      entry_type: "TRANSFER",
      description: `Sponsorship payout ${input.sponsorship_id}`,
      reference_type: "SPONSORSHIP",
      reference_id: input.sponsorship_id,
      idempotency_key: `sponsorship-payout-${input.sponsorship_id}`,
    })

    return {
      fee_entry: feeEntry,
      payout_entry: payoutEntry,
      platform_fee: platformFee,
      creator_amount: creatorAmount,
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Group Payment Processing
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Process the final group purchase when deal is approved.
   * Moves funds from escrow to the selected supplier.
   */
  async processGroupPurchase(input: {
    demand_post_id: string
    supplier_id: string
    total_amount: number
    platform_fee_percentage: number
  }) {
    const posts = await this.demandPoolService.listDemandPosts({
      id: input.demand_post_id,
    })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    const post = posts[0]
    const escrowAccountId = post.escrow_account_id as string
    if (!escrowAccountId) {
      throw new Error("Escrow account not set")
    }

    // Residuals below are computed from the final unit price, so its absence
    // is caught here, before any money moves, rather than after the drain has
    // already run. `selectSupplier` writes final_unit_price and
    // final_total_price together; a pool carrying a total but no unit price
    // is corrupt data, not a case to work around.
    const finalUnitPrice = Number(post.final_unit_price)
    if (!post.final_unit_price || !Number.isFinite(finalUnitPrice)) {
      throw new Error(
        "final_unit_price not set; cannot compute participant residuals"
      )
    }

    // Get supplier earnings account
    const supplierAccounts = await this.hawalaService.listLedgerAccounts({
      owner_type: "SELLER",
      owner_id: input.supplier_id,
      account_type: "SELLER_EARNINGS",
    })

    if (supplierAccounts.length === 0) {
      throw new Error("Supplier earnings account not found")
    }

    const platformFee = Math.floor(
      input.total_amount * (input.platform_fee_percentage / 100)
    )
    const supplierAmount = input.total_amount - platformFee

    const entries: any[] = []

    // Platform fee
    const platformAccount =
      await this.hawalaService.getOrCreateSystemAccount("PLATFORM_FEE")
    const feeEntry = await this.hawalaService.createTransfer({
      debit_account_id: escrowAccountId,
      credit_account_id: platformAccount.id,
      amount: platformFee,
      entry_type: "COMMISSION",
      description: `Platform fee for group purchase ${input.demand_post_id}`,
      reference_type: "ORDER",
      reference_id: input.demand_post_id,
      idempotency_key: `group-purchase-fee-${input.demand_post_id}`,
    })
    entries.push(feeEntry)

    // Supplier payment
    const supplierEntry = await this.hawalaService.createTransfer({
      debit_account_id: escrowAccountId,
      credit_account_id: supplierAccounts[0].id,
      amount: supplierAmount,
      entry_type: "TRANSFER",
      description: `Group purchase payment for demand ${input.demand_post_id}`,
      reference_type: "ORDER",
      reference_id: input.demand_post_id,
      idempotency_key: `group-purchase-supplier-${input.demand_post_id}`,
    })
    entries.push(supplierEntry)

    // Return each participant's escrow residual — whatever they escrowed
    // beyond `quantity_committed × final_unit_price`. Participants escrow a
    // free-form amount while the drain above moves exactly the final total,
    // so without this leg the difference stays in the pool's escrow account
    // with no path back out (docs/SAVINGS_ROUTING_SPEC.md §1–2, Tier 0).
    //
    // Strictly per-participant: the same escrow account also holds bounty
    // escrows, so sweeping the remaining balance would take bounty money. A
    // shortfall (under-escrow) is clamped to zero here — pool solvency is
    // enforced by the ledger's overdraft refusal, not by this leg.
    const participants = await this.demandPoolService.listDemandParticipants({
      demand_post_id: input.demand_post_id,
    })
    const escrowedParticipants = participants.filter(
      (p: any) => p.escrow_locked && Number(p.escrow_amount) > 0
    )

    const residuals: Array<{
      participant_id: string
      customer_id: string
      amount: number
      destination: "USER_WALLET" | "MUTUAL_AID"
      entry_id: string | null
    }> = []
    let remainingEscrowTotal = Number(post.total_escrowed)

    for (const participant of escrowedParticipants) {
      const escrowAmount = Number(participant.escrow_amount)
      const owed = roundCents(
        Number(participant.quantity_committed) * finalUnitPrice
      )
      const residual = roundCents(Math.max(0, escrowAmount - owed))

      let entryId: string | null = null
      let destination: "USER_WALLET" | "MUTUAL_AID" = "USER_WALLET"

      if (residual > 0) {
        const routeToMutualAid = shouldRouteToMutualAid(
          participant.surplus_disposition as string | null
        )

        let destinationId: string
        if (routeToMutualAid) {
          destination = "MUTUAL_AID"
          destinationId = requireMutualAidAccountId()
        } else {
          const wallets = await this.hawalaService.listLedgerAccounts({
            owner_type: "CUSTOMER",
            owner_id: participant.customer_id,
            account_type: "USER_WALLET",
          })
          if (wallets.length === 0) {
            throw new Error(
              `Customer wallet not found for participant ${participant.id}`
            )
          }
          destinationId = wallets[0].id
        }

        // ONE key regardless of destination — deliberately unlike the
        // destination-distinct keys in releaseParticipantEscrow. This runs
        // inside a multi-participant completion loop: if a crash-and-retry
        // straddled a disposition change, distinct keys would move the same
        // residual twice (once per destination), paying this participant out
        // of a pool balance that still owes everyone else. The disposition
        // is final once the first attempt routes the money; the dedupe in
        // createTransfer is what enforces that.
        const entry = await this.hawalaService.createTransfer({
          debit_account_id: escrowAccountId,
          credit_account_id: destinationId,
          amount: residual,
          entry_type: routeToMutualAid ? "TRANSFER" : "REFUND",
          description: routeToMutualAid
            ? `Escrow residual redirected to mutual aid for demand pool ${input.demand_post_id}`
            : `Escrow residual return for demand pool ${input.demand_post_id}`,
          reference_type: "ORDER",
          reference_id: input.demand_post_id,
          idempotency_key: `demand-residual-${participant.id}`,
        })
        entryId = entry.id
      }

      // Same bookkeeping as releaseParticipantEscrow, except the terminal
      // status: these participants completed their purchase, so they land on
      // CONFIRMED, not REFUNDED. Zeroing escrow_amount is also what makes a
      // retry of this method skip already-processed participants.
      await this.demandPoolService.updateDemandParticipants({
        id: participant.id,
        escrow_amount: 0,
        escrow_locked: false,
        status: ParticipantStatus.CONFIRMED,
      })

      // Same decrement convention as releaseParticipantEscrow: the pool's
      // total_escrowed tracks participant escrow still held, and this
      // participant's full amount has now been dispersed (drain legs plus
      // residual). Written per participant, not once after the loop, so a
      // mid-loop crash leaves the counter consistent with the participants
      // actually processed — a retry skips them and must not re-deduct.
      remainingEscrowTotal = Math.max(
        0,
        roundCents(remainingEscrowTotal - escrowAmount)
      )
      await this.demandPoolService.updateDemandPosts({
        id: input.demand_post_id,
        total_escrowed: remainingEscrowTotal,
      })

      residuals.push({
        participant_id: participant.id,
        customer_id: participant.customer_id as string,
        amount: residual,
        destination,
        entry_id: entryId,
      })
    }

    // Update demand post status
    await this.demandPoolService.updateDemandPosts({
      id: input.demand_post_id,
      status: DemandPostStatus.ORDER_PLACED,
    })

    return {
      entries,
      platform_fee: platformFee,
      supplier_amount: supplierAmount,
      residuals,
      residual_total: roundCents(
        residuals.reduce((sum, r) => sum + r.amount, 0)
      ),
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Savings Dashboard
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Calculate savings for a completed group buy compared to list price.
   */
  async calculateSavings(demandPostId: string) {
    const posts = await this.demandPoolService.listDemandPosts({
      id: demandPostId,
    })
    if (posts.length === 0) {
      throw new Error("Demand post not found")
    }

    const post = posts[0]
    if (!post.target_price || !post.final_unit_price) {
      return {
        demand_post_id: demandPostId,
        savings_per_unit: 0,
        total_savings: 0,
        savings_percentage: 0,
      }
    }

    const targetPrice = Number(post.target_price)
    const finalPrice = Number(post.final_unit_price)
    const quantity = Number(post.committed_quantity)

    const savingsPerUnit = Math.max(0, targetPrice - finalPrice)
    const totalSavings = savingsPerUnit * quantity
    const savingsPercentage =
      targetPrice > 0
        ? ((targetPrice - finalPrice) / targetPrice) * 100
        : 0

    return {
      demand_post_id: demandPostId,
      target_price: targetPrice,
      final_price: finalPrice,
      quantity,
      savings_per_unit: savingsPerUnit,
      total_savings: totalSavings,
      savings_percentage: Math.max(0, savingsPercentage),
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async getOrCreateDemandEscrow(demandPostId: string) {
    // Check if demand post already has an escrow account
    const posts = await this.demandPoolService.listDemandPosts({
      id: demandPostId,
    })
    if (posts.length > 0 && posts[0].escrow_account_id) {
      const accounts = await this.hawalaService.listLedgerAccounts({
        id: posts[0].escrow_account_id as string,
      })
      if (accounts.length > 0) return accounts[0]
    }

    // Create new escrow account for this demand pool
    const account = await this.hawalaService.createAccount({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: `demand-pool-${demandPostId}`,
      metadata: { demand_post_id: demandPostId },
    })

    // Link the escrow account to the demand post
    if (posts.length > 0) {
      await this.demandPoolService.updateDemandPosts({
        id: demandPostId,
        escrow_account_id: account.id,
      })
    }

    return account
  }

  /**
   * Get or create the escrow account that holds a single sponsorship's funds.
   * Keyed by `sponsorship-${id}` so escrow and payout resolve the same account.
   */
  private async getOrCreateSponsorshipEscrow(sponsorshipId: string) {
    const ownerId = `sponsorship-${sponsorshipId}`
    const existing = await this.hawalaService.listLedgerAccounts({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: ownerId,
    })
    if (existing.length > 0) {
      return existing[0]
    }

    return this.hawalaService.createAccount({
      account_type: "ESCROW",
      owner_type: "SYSTEM",
      owner_id: ownerId,
      metadata: { sponsorship_id: sponsorshipId },
    })
  }
}

/**
 * Factory function to create the service from the DI container.
 */
export function getCollectiveHawalaService(scope: any): CollectiveHawalaService {
  const hawalaService = scope.resolve("hawalaLedger")
  const demandPoolService = scope.resolve("demandPoolModuleService")
  return new CollectiveHawalaService(hawalaService, demandPoolService)
}
