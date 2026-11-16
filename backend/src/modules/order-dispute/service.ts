import { MedusaService } from "@medusajs/framework/utils"
import { OrderDispute, OrderDisputeEvent } from "./models"
import {
  AMOUNT_UNIT_METADATA_KEY,
  AMOUNT_UNIT_MINOR,
  DEFAULT_FILING_WINDOW_DAYS,
  DisputeAwardError,
  DisputeReason,
  DisputeStateError,
  DisputeStatus,
  assertDisputeTransition,
  isWithinFilingWindow,
  resolveAwardCents,
  resolveClaimCents,
  type DisputeActor,
} from "./resolution"

export { DisputeAwardError, DisputeStateError }

export type DisputeRow = {
  id: string
  order_id: string
  seller_id: string
  customer_id: string
  status: DisputeStatus
  reason: DisputeReason
  description: string
  currency_code: string
  claim_amount: number
  award_amount: number
  seller_response: string | null
  seller_responded_at: Date | null
  resolution_note: string | null
  resolved_at: Date | null
  resolved_by: string | null
  escrow_agreement_id: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Order disputes: the buyer-facing entry to arbitration that ordinary orders
 * never had.
 *
 * The lifecycle rules live in `resolution.ts` as pure functions. This class is
 * the case file, the append-only event log, and the admin queue.
 *
 * It moves no money. A resolution records what was decided and how much was
 * awarded; issuing the refund and, where an escrow exists, transitioning it
 * are the caller's job through the modules that own those things. Keeping
 * that boundary is why this never becomes a second ledger.
 */
class OrderDisputeService extends MedusaService({
  OrderDispute,
  OrderDisputeEvent,
}) {
  /**
   * The live dispute against ONE vendor on an order, if there is one.
   *
   * Seller-scoped to match `UQ_order_dispute_live`. Scoping by order alone
   * would refuse a buyer's dispute against Vendor B while their argument with
   * Vendor A on the same multi-vendor order was still open — taking away a
   * remedy rather than preventing a duplicate.
   */
  async liveForOrder(
    orderId: string,
    sellerId?: string
  ): Promise<DisputeRow | null> {
    const rows = (await this.listOrderDisputes({
      order_id: orderId,
      ...(sellerId ? { seller_id: sellerId } : {}),
      status: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW],
    })) as unknown as DisputeRow[]
    return rows[0] ?? null
  }

  /**
   * Raise a dispute.
   *
   * Refuses a second live claim against the SAME VENDOR on the same order: it
   * is the same argument, and two running at once could be resolved in
   * opposite directions by two admins. A different vendor on the same order is
   * a different argument and is allowed. The partial unique index on
   * `(order_id, seller_id)` is the backstop; this is the readable error.
   *
   * `orderTotalCents` and `claimCents` are minor units. The row is stamped
   * `metadata.amount_unit = "minor"` (see `AMOUNT_UNIT_METADATA_KEY`), so a
   * row written here can never be mistaken for one the old major-unit intake
   * wrote, even when the amounts are the same.
   */
  async open(args: {
    orderId: string
    sellerId: string
    customerId: string
    orderPlacedAt: Date | string
    orderTotalCents: number
    currencyCode?: string
    reason?: DisputeReason
    description: string
    claimCents?: number | null
    escrowAgreementId?: string | null
    filingWindowDays?: number
    /** Stored on the row as written, with `amount_unit: "minor"` added. */
    metadata?: Record<string, unknown> | null
    now?: Date
  }): Promise<DisputeRow> {
    const now = args.now ?? new Date()

    if (!args.description?.trim()) {
      throw new DisputeStateError("a dispute needs a description")
    }

    if (
      !isWithinFilingWindow({
        orderPlacedAt: args.orderPlacedAt,
        now,
        windowDays: args.filingWindowDays ?? DEFAULT_FILING_WINDOW_DAYS,
      })
    ) {
      throw new DisputeStateError(
        `this order is outside the ${
          args.filingWindowDays ?? DEFAULT_FILING_WINDOW_DAYS
        }-day window for raising a dispute`
      )
    }

    const existing = await this.liveForOrder(args.orderId, args.sellerId)
    if (existing) {
      throw new DisputeStateError(
        "there is already an open dispute against this vendor on this order"
      )
    }

    const claim = resolveClaimCents({
      requestedCents: args.claimCents,
      orderTotalCents: args.orderTotalCents,
    })

    const [row] = await this.createOrderDisputes([
      {
        order_id: args.orderId,
        seller_id: args.sellerId,
        customer_id: args.customerId,
        status: DisputeStatus.OPEN,
        reason: args.reason ?? DisputeReason.OTHER,
        description: args.description.trim(),
        currency_code: (args.currencyCode ?? "usd").toLowerCase(),
        claim_amount: claim,
        award_amount: 0,
        escrow_agreement_id: args.escrowAgreementId ?? null,
        // Written in the same insert as the amounts, after the caller's keys
        // so no caller can drop or change it: every row from here on says
        // its amounts are minor units, which is what lets
        // `scripts/fix-order-dispute-minor-units.ts` leave it alone.
        metadata: {
          ...(args.metadata ?? {}),
          [AMOUNT_UNIT_METADATA_KEY]: AMOUNT_UNIT_MINOR,
        },
      },
    ])

    const dispute = row as unknown as DisputeRow

    await this.createOrderDisputeEvents([
      {
        dispute_id: dispute.id,
        kind: "opened",
        actor_type: "buyer",
        actor_id: args.customerId,
        to_status: DisputeStatus.OPEN,
        message: args.description.trim(),
      },
    ])

    return dispute
  }

  /**
   * Record the vendor's answer.
   *
   * Does not change status. A vendor responding is evidence for the decision,
   * not the decision — letting a response move the case would let the party
   * being complained about advance it.
   */
  async respond(args: {
    disputeId: string
    sellerId: string
    response: string
    now?: Date
  }): Promise<DisputeRow> {
    const dispute = await this.require(args.disputeId)
    if (dispute.seller_id !== args.sellerId) {
      throw new DisputeStateError("not the vendor on this dispute")
    }
    if (
      dispute.status !== DisputeStatus.OPEN &&
      dispute.status !== DisputeStatus.UNDER_REVIEW
    ) {
      throw new DisputeStateError(
        `this dispute is ${dispute.status} and no longer accepts a response`
      )
    }
    if (!args.response?.trim()) {
      throw new DisputeStateError("a response needs text")
    }

    const now = args.now ?? new Date()
    await this.updateOrderDisputes({
      id: dispute.id,
      seller_response: args.response.trim(),
      seller_responded_at: now,
    })
    await this.createOrderDisputeEvents([
      {
        dispute_id: dispute.id,
        kind: "seller_responded",
        actor_type: "seller",
        actor_id: args.sellerId,
        message: args.response.trim(),
      },
    ])

    return this.require(dispute.id)
  }

  /** An admin picks the case up. */
  async takeUnderReview(args: {
    disputeId: string
    adminId: string
  }): Promise<DisputeRow> {
    return this.transition({
      disputeId: args.disputeId,
      to: DisputeStatus.UNDER_REVIEW,
      actor: "admin",
      actorId: args.adminId,
    })
  }

  /** The buyer drops the claim. */
  async withdraw(args: {
    disputeId: string
    actor: DisputeActor
    actorId: string
    note?: string
  }): Promise<DisputeRow> {
    return this.transition({
      disputeId: args.disputeId,
      to: DisputeStatus.WITHDRAWN,
      actor: args.actor,
      actorId: args.actorId,
      note: args.note,
    })
  }

  /**
   * Decide it.
   *
   * Records the outcome and the award. Issuing the refund and transitioning a
   * linked escrow are the caller's responsibility — see `escrowTransitionFor`
   * — because this module owns the argument, not the money.
   */
  async resolve(args: {
    disputeId: string
    adminId: string
    status: DisputeStatus.RESOLVED_REFUND | DisputeStatus.RESOLVED_RELEASE
    awardCents?: number | null
    note?: string
    now?: Date
  }): Promise<DisputeRow> {
    const dispute = await this.require(args.disputeId)
    assertDisputeTransition({
      from: dispute.status,
      to: args.status,
      actor: "admin",
    })

    const award = resolveAwardCents({
      status: args.status,
      awardCents: args.awardCents,
      claimCents: Math.floor(Number(dispute.claim_amount) || 0),
    })

    const now = args.now ?? new Date()
    await this.writeIfStatusUnchanged(dispute, {
      status: args.status,
      award_amount: award,
      resolution_note: args.note ?? null,
      resolved_at: now,
      resolved_by: args.adminId,
    })
    await this.createOrderDisputeEvents([
      {
        dispute_id: dispute.id,
        kind: "resolved",
        actor_type: "admin",
        actor_id: args.adminId,
        from_status: dispute.status,
        to_status: args.status,
        message: args.note ?? null,
        metadata: { award_amount: award },
      },
    ])

    return this.require(dispute.id)
  }

  /**
   * The corrective script's one write (`scripts/fix-order-dispute-minor-units.ts`):
   * set a row's claim and award to their minor-unit figures and record the
   * correction under `metadata.amount_units_corrected`, but only if the row
   * is still exactly what the correction was planned from. One
   * `UPDATE … WHERE id = ? AND status = ? AND claim_amount = ? AND award_amount = ?`,
   * atomic in Postgres, which also refuses a row that has since been marked
   * `amount_unit = "minor"` or already corrected (a second run at the same
   * time).
   *
   * It used to be a plain update by id. An admin deciding the case between
   * the script's read and its write was then overwritten by the script's
   * figures (a whole-claim refund of 25 reset to an award of 0 while the
   * status stayed resolved_refund), or kept an award computed from the old
   * claim against the corrected one. Now the row that changed is not
   * written, and the script reports it for review.
   *
   * Returns whether the row was written. Raw SQL for the reason given on
   * `writeIfStatusUnchanged`; the column names are this module's own.
   */
  async correctAmountsIfUnchanged(args: {
    id: string
    status: string
    from: { claim_amount: number; award_amount: number }
    to: { claim_amount: number; award_amount: number }
    record: Record<string, unknown>
  }): Promise<boolean> {
    const rows = await this.freshManager().execute(
      `UPDATE order_dispute SET claim_amount = ?, award_amount = ?, ` +
        `metadata = COALESCE(metadata, CAST('{}' AS jsonb)) || jsonb_build_object('amount_units_corrected', CAST(? AS jsonb)), ` +
        `updated_at = now() ` +
        `WHERE id = ? AND status = ? AND claim_amount = ? AND award_amount = ? AND deleted_at IS NULL ` +
        `AND (metadata ->> ?) IS DISTINCT FROM ? AND (metadata -> 'amount_units_corrected') IS NULL ` +
        `RETURNING id`,
      [
        args.to.claim_amount,
        args.to.award_amount,
        JSON.stringify(args.record),
        args.id,
        args.status,
        args.from.claim_amount,
        args.from.award_amount,
        AMOUNT_UNIT_METADATA_KEY,
        AMOUNT_UNIT_MINOR,
      ],
      "all"
    )
    return Array.isArray(rows) && rows.length === 1
  }

  /** The admin queue: everything still awaiting a decision, oldest first. */
  async queue(): Promise<DisputeRow[]> {
    const rows = (await this.listOrderDisputes(
      { status: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
      { order: { created_at: "ASC" } }
    )) as unknown as DisputeRow[]
    return rows
  }

  private async transition(args: {
    disputeId: string
    to: DisputeStatus
    actor: DisputeActor
    actorId: string
    note?: string
  }): Promise<DisputeRow> {
    const dispute = await this.require(args.disputeId)
    assertDisputeTransition({
      from: dispute.status,
      to: args.to,
      actor: args.actor,
    })

    await this.writeIfStatusUnchanged(dispute, {
      status: args.to,
      ...(args.note ? { resolution_note: args.note } : {}),
    })
    await this.createOrderDisputeEvents([
      {
        dispute_id: dispute.id,
        kind: "status_changed",
        actor_type: args.actor,
        actor_id: args.actorId,
        from_status: dispute.status,
        to_status: args.to,
        message: args.note ?? null,
      },
    ])

    return this.require(dispute.id)
  }

  /**
   * Write a status change only if the status is still the one it was decided
   * from: one `UPDATE … WHERE id = ? AND status = ?`, atomic in Postgres.
   *
   * `resolve` and `transition` read the row, check the move, then write. Two
   * admins deciding the same case at once both pass the check; with a plain
   * update both writes landed and the last won, so a refund already paid by
   * hand through Stripe could be overwritten by a release, with two
   * "resolved" events in the log. Now the second write matches no row and
   * is refused with the same `DisputeStateError` the route already answers
   * with 409, before its event is written.
   *
   * Raw SQL because the generated `updateOrderDisputes` with a selector
   * reads the matching rows and then updates them by id: the same race, one
   * layer down. The column names below are this module's own, never input.
   */
  private async writeIfStatusUnchanged(
    dispute: DisputeRow,
    set: Partial<
      Pick<
        DisputeRow,
        "status" | "award_amount" | "resolution_note" | "resolved_at" | "resolved_by"
      >
    >
  ): Promise<void> {
    const columns = Object.keys(set) as (keyof typeof set)[]
    const rows = await this.freshManager().execute(
      `UPDATE order_dispute SET ${columns.map((c) => `"${c}" = ?`).join(", ")}, updated_at = now() ` +
        `WHERE id = ? AND status = ? AND deleted_at IS NULL RETURNING id`,
      [...columns.map((c) => set[c] ?? null), dispute.id, dispute.status],
      "all"
    )

    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new DisputeStateError(
        `this dispute changed while it was being decided (it is no longer ${dispute.status}); reload it`
      )
    }
  }

  private freshManager(): {
    execute(sql: string, params: unknown[], method: "all"): Promise<unknown[]>
  } {
    return (
      this as unknown as {
        baseRepository_: {
          getFreshManager(): {
            execute(sql: string, params: unknown[], method: "all"): Promise<unknown[]>
          }
        }
      }
    ).baseRepository_.getFreshManager()
  }

  private async require(disputeId: string): Promise<DisputeRow> {
    const [row] = (await this.listOrderDisputes({
      id: disputeId,
    })) as unknown as DisputeRow[]
    if (!row) throw new DisputeStateError("dispute not found")
    return row
  }
}

export default OrderDisputeService
