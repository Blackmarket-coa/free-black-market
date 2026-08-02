import { MedusaService } from "@medusajs/framework/utils"
import { InferTypeOf } from "@medusajs/framework/types"
import {
  VendorPlan,
  VendorPlanAssignment,
  VendorPlanAssignedBy,
  VendorPlanEvent,
  VendorPlanEventType,
  VendorPlanStatus,
} from "./models"
import {
  DEFAULT_PLAN_CODE,
  featureKeysForPlan,
  getPlanDefinition,
  type VendorFeatureKey,
} from "./catalog"
import {
  applyPeriodRollover,
  decidePlanTransition,
  effectivePlanCode,
  isPendingChangeDue,
  reconcileFeatureKeys,
  type AssignmentSnapshot,
  type PlanTransitionDecision,
} from "./transitions"

export type VendorPlanType = InferTypeOf<typeof VendorPlan>
export type VendorPlanAssignmentType = InferTypeOf<typeof VendorPlanAssignment>
export type VendorPlanEventType_ = InferTypeOf<typeof VendorPlanEvent>

/** Postgres unique-violation. Used to detect an idempotency-key replay. */
const PG_UNIQUE_VIOLATION = "23505"

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code
  return code === PG_UNIQUE_VIOLATION || causeCode === PG_UNIQUE_VIOLATION
}

export type ApplyTransitionInput = {
  seller_id: string
  to_plan_code: string
  /** Dedupe key. A replay with the same key is a no-op. */
  idempotency_key?: string | null
  assigned_by?: VendorPlanAssignedBy
  /** Operator override: apply a downgrade now rather than at period end. */
  immediate?: boolean
  reason?: string
}

export type ApplyTransitionResult = {
  assignment: VendorPlanAssignmentType
  decision: PlanTransitionDecision
  /** True when the call was deduped by its idempotency key. */
  replayed: boolean
}

/**
 * Owns a seller's billing plan: the catalog, their assignment, and the
 * append-only transition log.
 *
 * Deliberately does NOT own entitlements. Granting and revoking is the
 * entitlement module's job — this service computes the desired feature set and
 * the caller applies it, so the plan module never becomes a second source of
 * truth for who holds what.
 *
 * It also never writes `seller_metadata.enabled_extensions`. That column
 * already has six competing writers; a seventh makes it unwinnable. It stays
 * the vendor's *preference* and plan entitlements are the *ceiling*, with the
 * intersection computed at read time.
 */
class VendorPlanService extends MedusaService({
  VendorPlan,
  VendorPlanAssignment,
  VendorPlanEvent,
}) {
  // ── Catalog ───────────────────────────────────────────────────────────────

  async listActivePlans(): Promise<VendorPlanType[]> {
    return this.listVendorPlans({ is_active: true }, { order: { display_order: "ASC" } })
  }

  async getPlanByCode(code: string): Promise<VendorPlanType | null> {
    const [row] = await this.listVendorPlans({ code })
    return row ?? null
  }

  // ── Assignment ────────────────────────────────────────────────────────────

  async getAssignment(
    seller_id: string
  ): Promise<VendorPlanAssignmentType | null> {
    if (!seller_id) return null
    const [row] = await this.listVendorPlanAssignments({ seller_id })
    return row ?? null
  }

  /**
   * The seller's assignment, creating a default one if absent.
   *
   * Self-healing on purpose: sellers are created by several paths, and with
   * enforcement live an unprovisioned seller would otherwise be indistinguishable
   * from one deliberately on the free plan. Both must resolve to a concrete
   * feature set.
   */
  async ensureAssignment(
    seller_id: string,
    opts: { assigned_by?: VendorPlanAssignedBy } = {}
  ): Promise<VendorPlanAssignmentType> {
    const existing = await this.getAssignment(seller_id)
    if (existing) return existing

    const now = new Date()
    const [created] = await this.createVendorPlanAssignments([
      {
        seller_id,
        plan_code: DEFAULT_PLAN_CODE,
        status: VendorPlanStatus.ACTIVE,
        started_at: now,
        activated_at: now,
        assigned_by: opts.assigned_by ?? VendorPlanAssignedBy.SYSTEM,
      },
    ])

    await this.recordEvent({
      seller_id,
      assignment_id: created.id,
      type: VendorPlanEventType.ASSIGNED,
      to_plan_code: DEFAULT_PLAN_CODE,
      // No idempotency key: creation is already guarded by the unique
      // seller_id index, and a key here would be a second, weaker guard.
      payload: { auto_provisioned: true },
    })

    return created
  }

  /** The plan code a seller is effectively on right now. */
  async getEffectivePlanCode(seller_id: string): Promise<string> {
    const assignment = await this.ensureAssignment(seller_id)
    return effectivePlanCode(this.toSnapshot(assignment))
  }

  /** Feature keys the seller's current plan grants. */
  async getEntitledFeatureKeys(
    seller_id: string
  ): Promise<VendorFeatureKey[]> {
    return featureKeysForPlan(await this.getEffectivePlanCode(seller_id))
  }

  // ── Transitions ───────────────────────────────────────────────────────────

  /**
   * The single funnel for every plan change.
   *
   * The event row is written FIRST so its unique `idempotency_key` decides
   * whether this call is a replay, before anything else is touched. A replayed
   * Stripe webhook or re-fired cron therefore returns the prior state rather
   * than transitioning twice.
   */
  async applyPlanTransition(
    input: ApplyTransitionInput
  ): Promise<ApplyTransitionResult> {
    const now = new Date()
    const assignment = await this.ensureAssignment(input.seller_id)
    const snapshot = this.toSnapshot(assignment)

    if (input.idempotency_key) {
      const claimed = await this.claimIdempotencyKey({
        seller_id: input.seller_id,
        assignment_id: assignment.id,
        idempotency_key: input.idempotency_key,
        from_plan_code: assignment.plan_code,
        to_plan_code: input.to_plan_code,
      })
      if (!claimed) {
        return {
          assignment,
          decision: { kind: "rejected", reason: "replayed idempotency key" },
          replayed: true,
        }
      }
    }

    const decision = decidePlanTransition({
      current: snapshot,
      to_plan_code: input.to_plan_code,
      immediate: input.immediate,
      now,
    })

    if (decision.kind === "rejected") {
      return { assignment, decision, replayed: false }
    }

    if (decision.kind === "deferred") {
      const [updated] = await this.updateVendorPlanAssignments([
        {
          id: assignment.id,
          pending_plan_code: decision.to_plan_code,
          pending_effective_at: decision.effective_at,
        },
      ])
      await this.recordEvent({
        seller_id: input.seller_id,
        assignment_id: assignment.id,
        type: VendorPlanEventType.DOWNGRADED,
        from_plan_code: assignment.plan_code,
        to_plan_code: decision.to_plan_code,
        payload: {
          deferred: true,
          effective_at: decision.effective_at.toISOString(),
          reason: input.reason ?? decision.reason,
        },
      })
      return { assignment: updated, decision, replayed: false }
    }

    const updated = await this.writeImmediateChange({
      assignment,
      to_plan_code: decision.to_plan_code,
      assigned_by: input.assigned_by,
      now,
    })

    await this.recordEvent({
      seller_id: input.seller_id,
      assignment_id: assignment.id,
      type:
        decision.change === "downgrade"
          ? VendorPlanEventType.DOWNGRADED
          : VendorPlanEventType.UPGRADED,
      from_plan_code: assignment.plan_code,
      to_plan_code: decision.to_plan_code,
      payload: { reason: input.reason ?? decision.reason },
    })

    return { assignment: updated, decision, replayed: false }
  }

  /** Apply a scheduled downgrade whose effective date has arrived. */
  async applyPendingChange(
    seller_id: string,
    now: Date = new Date()
  ): Promise<VendorPlanAssignmentType | null> {
    const assignment = await this.getAssignment(seller_id)
    if (!assignment) return null
    if (!isPendingChangeDue(this.toSnapshot(assignment), now)) return null

    const toPlan = assignment.pending_plan_code as string
    const updated = await this.writeImmediateChange({
      assignment,
      to_plan_code: toPlan,
      now,
    })

    await this.recordEvent({
      seller_id,
      assignment_id: assignment.id,
      type: VendorPlanEventType.DOWNGRADED,
      from_plan_code: assignment.plan_code,
      to_plan_code: toPlan,
      idempotency_key: `${assignment.id}:pending:${
        assignment.pending_effective_at
          ? new Date(assignment.pending_effective_at).toISOString()
          : "unknown"
      }`,
      payload: { applied_from_pending: true },
    })

    return updated
  }

  /** Every assignment with a pending change now due. */
  async listDuePendingChanges(
    now: Date = new Date()
  ): Promise<VendorPlanAssignmentType[]> {
    const rows = await this.listVendorPlanAssignments({
      pending_effective_at: { $lte: now },
    } as Record<string, unknown>)
    return rows.filter((r) => !!r.pending_plan_code)
  }

  /** Schedule cancellation at period end; falls back to immediate. */
  async cancelAtPeriodEnd(
    seller_id: string,
    reason?: string
  ): Promise<VendorPlanAssignmentType> {
    const assignment = await this.ensureAssignment(seller_id)
    const [updated] = await this.updateVendorPlanAssignments([
      {
        id: assignment.id,
        cancel_at_period_end: true,
        pending_plan_code: DEFAULT_PLAN_CODE,
        pending_effective_at: assignment.current_period_end ?? new Date(),
      },
    ])
    await this.recordEvent({
      seller_id,
      assignment_id: assignment.id,
      type: VendorPlanEventType.CANCELED,
      from_plan_code: assignment.plan_code,
      to_plan_code: DEFAULT_PLAN_CODE,
      payload: { reason: reason ?? "canceled by request" },
    })
    return updated
  }

  /**
   * The feature-key delta a seller's current plan implies.
   *
   * Callers hand `current_keys` (what the seller actually holds, from the
   * entitlement module) and apply the returned delta. Kept as a computation so
   * this service never has to reach into entitlements itself.
   */
  async planReconciliation(
    seller_id: string,
    current_keys: readonly string[]
  ): Promise<{
    plan_code: string
    desired: VendorFeatureKey[]
    to_grant: VendorFeatureKey[]
    to_revoke: string[]
  }> {
    const plan_code = await this.getEffectivePlanCode(seller_id)
    return { plan_code, ...reconcileFeatureKeys({ plan_code, current_keys }) }
  }

  /** Roll an assignment into its next billing period. */
  async rollPeriod(
    seller_id: string,
    now: Date = new Date()
  ): Promise<VendorPlanAssignmentType | null> {
    const assignment = await this.getAssignment(seller_id)
    if (!assignment) return null

    const rolled = applyPeriodRollover({
      plan_code: assignment.plan_code,
      current_period_end: assignment.current_period_end as Date | null,
      now,
    })
    if (!rolled) return assignment

    const [updated] = await this.updateVendorPlanAssignments([
      { id: assignment.id, ...rolled },
    ])

    await this.recordEvent({
      seller_id,
      assignment_id: assignment.id,
      type: VendorPlanEventType.RENEWED,
      from_plan_code: assignment.plan_code,
      to_plan_code: assignment.plan_code,
      idempotency_key: `${assignment.id}:renew:${rolled.current_period_end.toISOString()}`,
      payload: {
        period_start: rolled.current_period_start.toISOString(),
        period_end: rolled.current_period_end.toISOString(),
      },
    })

    return updated
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private toSnapshot(a: VendorPlanAssignmentType): AssignmentSnapshot {
    return {
      plan_code: a.plan_code,
      status: a.status as VendorPlanStatus,
      current_period_end: (a.current_period_end as Date | null) ?? null,
      cancel_at_period_end: !!a.cancel_at_period_end,
      pending_plan_code: (a.pending_plan_code as string | null) ?? null,
      pending_effective_at: (a.pending_effective_at as Date | null) ?? null,
    }
  }

  private async writeImmediateChange(args: {
    assignment: VendorPlanAssignmentType
    to_plan_code: string
    assigned_by?: VendorPlanAssignedBy
    now: Date
  }): Promise<VendorPlanAssignmentType> {
    const def = getPlanDefinition(args.to_plan_code)
    const rolled = applyPeriodRollover({
      plan_code: args.to_plan_code,
      current_period_end: null,
      now: args.now,
    })

    const [updated] = await this.updateVendorPlanAssignments([
      {
        id: args.assignment.id,
        plan_code: args.to_plan_code,
        status: VendorPlanStatus.ACTIVE,
        activated_at: args.now,
        // Clear any scheduled change — it has been superseded.
        pending_plan_code: null,
        pending_effective_at: null,
        cancel_at_period_end: false,
        canceled_at: null,
        dunning_attempts: 0,
        next_retry_at: null,
        ...(rolled ?? {}),
        ...(def && def.trial_days > 0
          ? {
              trial_ends_at: new Date(
                args.now.getTime() + def.trial_days * 86_400_000
              ),
            }
          : {}),
        ...(args.assigned_by ? { assigned_by: args.assigned_by } : {}),
      },
    ])
    return updated
  }

  /**
   * Insert the idempotency-keyed event row. Returns false when the key was
   * already used, which is how a replay is detected.
   */
  private async claimIdempotencyKey(args: {
    seller_id: string
    assignment_id: string
    idempotency_key: string
    from_plan_code: string
    to_plan_code: string
  }): Promise<boolean> {
    const [existing] = await this.listVendorPlanEvents({
      idempotency_key: args.idempotency_key,
    })
    if (existing) return false

    try {
      await this.createVendorPlanEvents([
        {
          seller_id: args.seller_id,
          assignment_id: args.assignment_id,
          type: VendorPlanEventType.RECONCILED,
          from_plan_code: args.from_plan_code,
          to_plan_code: args.to_plan_code,
          idempotency_key: args.idempotency_key,
          occurred_at: new Date(),
          payload: { claim: true },
        },
      ])
      return true
    } catch (err) {
      // Lost a race to a concurrent caller holding the same key — that caller
      // is performing the transition, so this one must not repeat it.
      if (isUniqueViolation(err)) return false
      throw err
    }
  }

  private async recordEvent(args: {
    seller_id: string
    assignment_id: string
    type: VendorPlanEventType
    from_plan_code?: string | null
    to_plan_code?: string | null
    idempotency_key?: string | null
    payload?: Record<string, unknown> | null
  }): Promise<void> {
    try {
      await this.createVendorPlanEvents([
        {
          seller_id: args.seller_id,
          assignment_id: args.assignment_id,
          type: args.type,
          from_plan_code: args.from_plan_code ?? null,
          to_plan_code: args.to_plan_code ?? null,
          idempotency_key: args.idempotency_key ?? null,
          payload: args.payload ?? null,
          occurred_at: new Date(),
        },
      ])
    } catch (err) {
      // A duplicate history row must never fail the transition that produced
      // it — the assignment is already updated and is the operative state.
      if (!isUniqueViolation(err)) throw err
    }
  }
}

export default VendorPlanService
