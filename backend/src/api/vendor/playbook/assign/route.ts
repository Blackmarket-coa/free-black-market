import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../../shared"
import {
  assignPlaybookWorkflow,
  type AssignPlaybookInput,
} from "../../../../workflows/assign-playbook"
import {
  PLAYBOOK_MODULE,
  PLAYBOOK_IDS,
  type PlaybookId,
} from "../../../../modules/playbook"

type PostBody = {
  recipe_id?: string
  answers?: AssignPlaybookInput["answers"]
  recommended_recipe_id?: string
  overridden?: boolean
}

const SIZE_VALUES = new Set(["solo", "small", "medium", "federation"])
const GOVERNANCE_VALUES = new Set([
  "i_decide",
  "informal_agreement",
  "circles",
  "elected_reps",
  "federation_council",
])
const OFFERING_VALUES = new Set([
  "make_or_grow",
  "services",
  "subscription_or_season",
  "kitchen_food",
  "harvest_pool",
  "aggregator",
])

function isPlaybookId(value: unknown): value is PlaybookId {
  return typeof value === "string" && (PLAYBOOK_IDS as string[]).includes(value)
}

function validateAnswers(answers: unknown): {
  ok: true
  value: AssignPlaybookInput["answers"]
} | { ok: false; message: string } {
  if (answers === undefined || answers === null) {
    return { ok: true, value: undefined }
  }
  if (typeof answers !== "object") {
    return { ok: false, message: "answers must be an object" }
  }
  const a = answers as Record<string, unknown>
  if (!SIZE_VALUES.has(String(a.size))) {
    return { ok: false, message: `Invalid answers.size: ${String(a.size)}` }
  }
  if (!GOVERNANCE_VALUES.has(String(a.governance))) {
    return { ok: false, message: `Invalid answers.governance: ${String(a.governance)}` }
  }
  if (!OFFERING_VALUES.has(String(a.offering))) {
    return { ok: false, message: `Invalid answers.offering: ${String(a.offering)}` }
  }
  return {
    ok: true,
    value: {
      size: a.size,
      governance: a.governance,
      offering: a.offering,
    } as AssignPlaybookInput["answers"],
  }
}

/**
 * GET /vendor/playbook/assign
 *
 * Returns the authenticated seller's current playbook assignment, or
 * `null` when none exists. Used by the onboarding gate and the
 * dashboard banner to decide whether to surface the picker.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const playbookService: any = req.scope.resolve(PLAYBOOK_MODULE)
    const [assignment] = await playbookService.listPlaybookAssignments({
      seller_id: sellerId,
    })
    return res.json({ playbook_assignment: assignment ?? null })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[GET /vendor/playbook/assign] Error:", message)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to fetch playbook assignment",
    })
  }
}

/**
 * POST /vendor/playbook/assign
 *
 * Upserts the seller's playbook assignment via `assignPlaybookWorkflow`.
 * The workflow is idempotent (unique on `seller_id`); re-posting with a
 * different `recipe_id` updates the existing row in place.
 *
 * Body:
 *   - recipe_id (required): one of the ten PlaybookIds
 *   - answers (optional): { size, governance, offering }
 *   - recommended_recipe_id (optional): what the picker showed
 *   - overridden (optional): true when the user picked a non-recommended
 *     recipe; ignored if `recommended_recipe_id` differs from `recipe_id`
 *     (the workflow derives it).
 */
export async function POST(
  req: AuthenticatedMedusaRequest<PostBody>,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const body = (req.body ?? {}) as PostBody

  if (!isPlaybookId(body.recipe_id)) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Invalid recipe_id: ${String(body.recipe_id)}. Must be one of ${PLAYBOOK_IDS.join(", ")}`,
    })
  }

  if (
    body.recommended_recipe_id !== undefined &&
    body.recommended_recipe_id !== null &&
    !isPlaybookId(body.recommended_recipe_id)
  ) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Invalid recommended_recipe_id: ${String(body.recommended_recipe_id)}`,
    })
  }

  const answersResult = validateAnswers(body.answers)
  if (!answersResult.ok) {
    return res.status(400).json({
      type: "invalid_data",
      message: answersResult.message,
    })
  }

  try {
    const input: AssignPlaybookInput = {
      seller_id: sellerId,
      recipe_id: body.recipe_id,
      answers: answersResult.value,
      recommended_recipe_id: isPlaybookId(body.recommended_recipe_id)
        ? body.recommended_recipe_id
        : undefined,
      // `migrated_from` is server-controlled (set by backfill script);
      // ignore any client-supplied value here.
      migrated_from: null,
    }

    const { result } = await assignPlaybookWorkflow(req.scope).run({ input })
    return res.json({ playbook_assignment: result.playbook_assignment })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[POST /vendor/playbook/assign] Error:", message)
    return res.status(500).json({
      type: "server_error",
      message: `Failed to assign playbook: ${message}`,
    })
  }
}
