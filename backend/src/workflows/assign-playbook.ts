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
  metadata?: Record<string, any>
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

    return new StepResponse(
      Array.isArray(row) ? row[0] : row,
      Array.isArray(row) ? row[0]?.id : row?.id
    )
  },
  async (assignmentId, { container }) => {
    if (!assignmentId) return
    const playbookService: any = container.resolve(PLAYBOOK_MODULE)
    await playbookService.deletePlaybookAssignments(assignmentId)
  }
)

export const assignPlaybookWorkflow = createWorkflow(
  "assign-playbook",
  (input: AssignPlaybookInput) => {
    const assignment = assignPlaybookStep(input)
    return new WorkflowResponse({ playbook_assignment: assignment })
  }
)

export default assignPlaybookWorkflow
