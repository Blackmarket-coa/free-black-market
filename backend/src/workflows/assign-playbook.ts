import {
  createStep,
  StepResponse,
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PLAYBOOK_MODULE } from "../modules/playbook"
import type {
  PlaybookId,
  SizeAnswer,
  GovernanceAnswer,
  OfferingAnswer,
} from "../modules/playbook"
import { findEdge } from "../modules/playbook/progressions"

export type AssignPlaybookInput = {
  seller_id: string
  /** Chosen recipe id (may differ from the recommendation when overridden). */
  recipe_id: PlaybookId
  /** Picker answers (omitted for backfill / programmatic assignment). */
  answers?: {
    size: SizeAnswer
    governance: GovernanceAnswer
    offering: OfferingAnswer
  }
  /** Recommendation that the user was shown, if any. */
  recommended_recipe_id?: PlaybookId
  /** Legacy `seller_metadata.vendor_type` value, when migrating. */
  migrated_from?: string | null
  /**
   * Free text the vendor optionally gave for changing playbooks. Recorded on
   * the transition, never required and never inferred.
   */
  reason?: string | null
  /**
   * Count of the seller's products whose listing-type the target playbook does
   * not allow, as shown to them before they confirmed. Advisory only — nothing
   * is blocked or rewritten; see `modules/playbook/models/playbook-transition.ts`.
   */
  stranded_listing_count?: number
  metadata?: Record<string, any>
}

type AssignCompensation = {
  assignmentId?: string
  /** Present when the step updated an existing row rather than creating one. */
  previous?: Record<string, any>
}

const assignPlaybookStep = createStep(
  "assign-playbook-step",
  async (input: AssignPlaybookInput, { container }) => {
    const playbookService: any = container.resolve(PLAYBOOK_MODULE)

    const [playbookRow] = await playbookService.listPlaybooks({
      recipe_id: input.recipe_id,
    })
    if (!playbookRow) {
      throw new Error(
        `assign-playbook: playbook recipe "${input.recipe_id}" not found in registry (re-run seed-playbooks)`
      )
    }

    const [existing] = await playbookService.listPlaybookAssignments({
      seller_id: input.seller_id,
    })

    const overridden = Boolean(
      input.recommended_recipe_id &&
        input.recommended_recipe_id !== input.recipe_id
    )

    const payload = {
      seller_id: input.seller_id,
      playbook_id: playbookRow.id,
      recipe_id: input.recipe_id,
      q1_size: input.answers?.size ?? null,
      q2_governance: input.answers?.governance ?? null,
      q3_offering: input.answers?.offering ?? null,
      recommended_recipe_id: input.recommended_recipe_id ?? null,
      overridden,
      migrated_from: input.migrated_from ?? null,
      assigned_at: new Date(),
      metadata: input.metadata ?? null,
    }

    const row = existing
      ? await playbookService.updatePlaybookAssignments({
          id: existing.id,
          ...payload,
        })
      : await playbookService.createPlaybookAssignments(payload)

    const assignment = Array.isArray(row) ? row[0] : row

    // Rolling back an *update* by deleting the row would destroy the seller's
    // previous assignment over a downstream failure. Carry the prior values so
    // compensation can restore them; only a row this step created is deleted.
    const compensation: AssignCompensation = existing
      ? {
          assignmentId: existing.id,
          previous: {
            id: existing.id,
            playbook_id: existing.playbook_id,
            recipe_id: existing.recipe_id,
            q1_size: existing.q1_size,
            q2_governance: existing.q2_governance,
            q3_offering: existing.q3_offering,
            recommended_recipe_id: existing.recommended_recipe_id,
            overridden: existing.overridden,
            migrated_from: existing.migrated_from,
            assigned_at: existing.assigned_at,
            metadata: existing.metadata,
          },
        }
      : { assignmentId: assignment?.id }

    return new StepResponse(
      {
        assignment,
        /** Null on a seller's first assignment — there is no `from` yet. */
        previous_recipe_id: (existing?.recipe_id as PlaybookId | undefined) ?? null,
      },
      compensation
    )
  },
  async (compensation: AssignCompensation | undefined, { container }) => {
    if (!compensation?.assignmentId) return
    const playbookService: any = container.resolve(PLAYBOOK_MODULE)
    if (compensation.previous) {
      await playbookService.updatePlaybookAssignments(compensation.previous)
      return
    }
    await playbookService.deletePlaybookAssignments(compensation.assignmentId)
  }
)

type RecordTransitionInput = {
  seller_id: string
  from_recipe_id: PlaybookId | null
  to_recipe_id: PlaybookId
  reason?: string | null
  stranded_listing_count?: number
}

/**
 * Append one row to the playbook history when the recipe actually changed.
 *
 * A first assignment writes nothing — there is no transition from nothing to
 * something, and recording one would invent history. Re-posting the same
 * recipe (the picker is idempotent) writes nothing either.
 */
const recordPlaybookTransitionStep = createStep(
  "record-playbook-transition-step",
  async (input: RecordTransitionInput, { container }) => {
    if (!input.from_recipe_id || input.from_recipe_id === input.to_recipe_id) {
      return new StepResponse(null, undefined)
    }

    const playbookService: any = container.resolve(PLAYBOOK_MODULE)
    const edge = findEdge(input.from_recipe_id, input.to_recipe_id)

    const row = await playbookService.createPlaybookTransitions({
      seller_id: input.seller_id,
      from_recipe_id: input.from_recipe_id,
      to_recipe_id: input.to_recipe_id,
      kind: edge?.kind ?? null,
      engines: edge?.engines ?? null,
      matched_progression: Boolean(edge),
      reason: input.reason ?? null,
      stranded_listing_count: input.stranded_listing_count ?? 0,
      occurred_at: new Date(),
    })

    const transition = Array.isArray(row) ? row[0] : row
    return new StepResponse(transition, transition?.id)
  },
  async (transitionId, { container }) => {
    if (!transitionId) return
    const playbookService: any = container.resolve(PLAYBOOK_MODULE)
    await playbookService.deletePlaybookTransitions(transitionId)
  }
)

export const assignPlaybookWorkflow = createWorkflow(
  "assign-playbook",
  (input: AssignPlaybookInput) => {
    const assigned = assignPlaybookStep(input)

    const transition = recordPlaybookTransitionStep({
      seller_id: input.seller_id,
      from_recipe_id: assigned.previous_recipe_id,
      to_recipe_id: input.recipe_id,
      reason: input.reason,
      stranded_listing_count: input.stranded_listing_count,
    } as unknown as RecordTransitionInput)

    return new WorkflowResponse({
      playbook_assignment: assigned.assignment,
      /** Null when nothing changed (first assignment, or same recipe re-posted). */
      transition,
    })
  }
)

export default assignPlaybookWorkflow
